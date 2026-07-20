package enrich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/a2chatsky/sudrf-parser-worker/internal/catalog"
	"github.com/a2chatsky/sudrf-parser-worker/internal/courts"
	"github.com/a2chatsky/sudrf-parser-worker/internal/sudrf"
)

type Config struct {
	NodeURL       string
	Region        string
	PerTick       int
	Concurrent    int
	DelayMs       int
	DetailTimeout time.Duration
}

type Stats struct {
	TotalEnriched atomic.Int64
	TotalFailed   atomic.Int64
	TotalDocs     atomic.Int64
}

type Runner struct {
	cfg    Config
	store  catalog.Backend
	courts map[string]courts.Entry
	stats  Stats
}

func New(cfg Config, store catalog.Backend, courtList []courts.Entry) *Runner {
	m := make(map[string]courts.Entry, len(courtList))
	for _, c := range courtList {
		m[c.Subdomain] = c
	}
	return &Runner{cfg: cfg, store: store, courts: m}
}

func (r *Runner) StatsSnapshot() (enriched, failed, docs int64) {
	return r.stats.TotalEnriched.Load(), r.stats.TotalFailed.Load(), r.stats.TotalDocs.Load()
}

func (r *Runner) Tick() {
	if r.cfg.NodeURL == "" {
		return
	}
	_ = r.store.ReloadIfChanged()
	pending := r.store.ListPending(r.cfg.Region, r.cfg.PerTick)
	if len(pending) == 0 {
		return
	}
	log.Printf("[enrich] queue %d cases (region=%s)", len(pending), r.cfg.Region)

	sem := make(chan struct{}, max(1, r.cfg.Concurrent))
	var wg sync.WaitGroup
	for _, c := range pending {
		wg.Add(1)
		sem <- struct{}{}
		go func(c *catalog.Case) {
			defer wg.Done()
			defer func() { <-sem }()
			r.enrichOne(c)
			if r.cfg.DelayMs > 0 {
				time.Sleep(time.Duration(r.cfg.DelayMs) * time.Millisecond)
			}
		}(c)
	}
	wg.Wait()
}

func (r *Runner) enrichOne(c *catalog.Case) {
	entry, ok := r.courts[c.CourtSubdomain]
	preferHTTP := ok && entry.HTTP
	path := c.CaseURL
	if strings.HasPrefix(path, "http") {
		if idx := strings.Index(path, ".ru"); idx >= 0 {
			path = path[idx+3:]
		}
	}
	if !strings.HasPrefix(path, "/") {
		log.Printf("[enrich] bad caseUrl %s (%s)", c.ID, path)
		r.stats.TotalFailed.Add(1)
		return
	}

	res, err := sudrf.Fetch(c.CourtSubdomain, path, preferHTTP, r.cfg.DetailTimeout)
	if err != nil {
		log.Printf("[enrich] fetch %s: %v", c.ID, err)
		r.stats.TotalFailed.Add(1)
		return
	}

	body, _ := json.Marshal(map[string]string{
		"id":             c.ID,
		"courtSubdomain": c.CourtSubdomain,
		"caseUrl":        c.CaseURL,
		"html":           res.HTML,
	})
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(r.cfg.NodeURL, "/")+"/api/internal/enrich-html", bytes.NewReader(body))
	if err != nil {
		r.stats.TotalFailed.Add(1)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[enrich] node %s: %v", c.ID, err)
		r.stats.TotalFailed.Add(1)
		return
	}
	defer resp.Body.Close()

	var out struct {
		Enriched  bool `json:"enriched"`
		Documents int  `json:"documents"`
		Error     string `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != 200 || out.Error != "" {
		log.Printf("[enrich] node %s: status=%d err=%s", c.ID, resp.StatusCode, out.Error)
		r.stats.TotalFailed.Add(1)
		return
	}
	if out.Enriched {
		r.stats.TotalEnriched.Add(1)
		r.stats.TotalDocs.Add(int64(out.Documents))
		log.Printf("[enrich] ok %s docs=%d", c.CaseNumber, out.Documents)
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (r *Runner) String() string {
	e, f, d := r.StatsSnapshot()
	return fmt.Sprintf("enriched=%d failed=%d docs=%d", e, f, d)
}
