package scheduler

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/a2chatsky/sudrf-parser-worker/internal/catalog"
	"github.com/a2chatsky/sudrf-parser-worker/internal/config"
	"github.com/a2chatsky/sudrf-parser-worker/internal/courts"
	"github.com/a2chatsky/sudrf-parser-worker/internal/enrich"
	"github.com/a2chatsky/sudrf-parser-worker/internal/sudrf"
)

type CourtTask struct {
	Court         courts.Entry
	LastParsed    time.Time
	NextScheduled time.Time
	CasesFound    int
	CasesParsed   int
	FailCount     int
}

type Stats struct {
	Running        bool   `json:"running"`
	TotalParsed    int64  `json:"totalParsed"`
	TotalFailed    int64  `json:"totalFailed"`
	TotalEnriched  int64  `json:"totalEnriched"`
	TotalDocuments int64  `json:"totalDocuments"`
	EnrichFailed   int64  `json:"enrichFailed"`
	CatalogSize    int    `json:"catalogSize"`
	EnrichPending  int    `json:"enrichPending"`
	LastCourt      string `json:"lastCourt,omitempty"`
	LastUpdate     string `json:"lastUpdate"`
	Region         string `json:"region"`
	CourtsTotal    int    `json:"courtsTotal"`
	EnrichEnabled  bool   `json:"enrichEnabled"`
}

type Scheduler struct {
	cfg     config.Config
	store   catalog.Backend
	courts  []courts.Entry
	tasks   map[string]*CourtTask
	order   []string
	cursor  int
	enrich  *enrich.Runner
	running atomic.Bool

	totalParsed atomic.Int64
	totalFailed atomic.Int64
	lastCourt   atomic.Value // string
	lastUpdate  atomic.Value // time.Time

	mu sync.Mutex
}

func New(cfg config.Config, store catalog.Backend, courtList []courts.Entry) *Scheduler {
	filtered := courts.ByRegion(courtList, cfg.Region)
	courts.SortByScore(filtered)
	s := &Scheduler{
		cfg:    cfg,
		store:  store,
		courts: filtered,
		tasks:  map[string]*CourtTask{},
		order:  make([]string, 0, len(filtered)),
	}
	if cfg.EnrichEnabled && cfg.NodeURL != "" {
		s.enrich = enrich.New(enrich.Config{
			NodeURL:       cfg.NodeURL,
			Region:        cfg.Region,
			PerTick:       cfg.EnrichPerTick,
			Concurrent:    cfg.EnrichConcurrent,
			DelayMs:       cfg.EnrichDelayMs,
			DetailTimeout: 35 * time.Second,
		}, store, courtList)
	}
	for _, c := range filtered {
		s.tasks[c.Subdomain] = &CourtTask{Court: c, NextScheduled: time.Now()}
		s.order = append(s.order, c.Subdomain)
	}
	s.lastUpdate.Store(time.Now())
	log.Printf("[parser-worker] region=%s courts=%d catalog=%s", cfg.Region, len(filtered), store.Path())
	return s
}

func (s *Scheduler) Start() {
	if s.running.Swap(true) {
		return
	}
	go s.loop()
}

func (s *Scheduler) Stop() {
	s.running.Store(false)
}

func (s *Scheduler) loop() {
	tick := time.NewTicker(time.Duration(s.cfg.TickIntervalSec) * time.Second)
	defer tick.Stop()
	for s.running.Load() {
		s.tick()
		<-tick.C
	}
}

func (s *Scheduler) tick() {
	_ = s.store.ReloadIfChanged()
	n := s.cfg.ConcurrentCourts
	if n > len(s.order) {
		n = len(s.order)
	}
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		sub := s.nextCourt()
		if sub == "" {
			break
		}
		task := s.tasks[sub]
		if time.Now().Before(task.NextScheduled) {
			continue
		}
		wg.Add(1)
		go func(t *CourtTask) {
			defer wg.Done()
			s.parseCourt(t)
		}(task)
	}
	wg.Wait()

	if s.enrich != nil {
		s.enrich.Tick()
	}
}

func (s *Scheduler) nextCourt() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.order) == 0 {
		return ""
	}
	sub := s.order[s.cursor%len(s.order)]
	s.cursor++
	return sub
}

func (s *Scheduler) scheduleDates() []string {
	now := time.Now()
	dates := make([]string, 0, s.cfg.ScheduleDays+s.cfg.ScheduleDaysBack+1)
	for d := s.cfg.ScheduleDaysBack; d >= 0; d-- {
		t := now.AddDate(0, 0, -d)
		dates = append(dates, formatDate(t))
	}
	for d := 1; d <= s.cfg.ScheduleDays; d++ {
		t := now.AddDate(0, 0, d)
		dates = append(dates, formatDate(t))
	}
	return dates
}

func formatDate(t time.Time) string {
	return fmt.Sprintf("%02d.%02d.%d", t.Day(), int(t.Month()), t.Year())
}

func (s *Scheduler) parseCourt(task *CourtTask) {
	c := task.Court
	s.lastCourt.Store(c.Subdomain)
	log.Printf("[parser-worker] %s — fetching schedule...", c.Subdomain)

	dates := s.scheduleDates()
	var all []sudrf.HearingItem
	var hadError bool

	for _, dateStr := range dates {
		path := sudrf.SchedulePath(dateStr)
		res, err := sudrf.Fetch(c.Subdomain, path, c.HTTP, 35*time.Second)
		if err != nil {
			log.Printf("[parser-worker] %s — %s failed: %v", c.Subdomain, dateStr, err)
			hadError = true
			continue
		}
		parsed := sudrf.ParseHearingSchedule(res.HTML, c.Name, dateStr)
		if parsed.Status == "antibot" {
			log.Printf("[parser-worker] %s — antibot on %s", c.Subdomain, dateStr)
			hadError = true
			continue
		}
		all = append(all, parsed.Items...)
	}

	task.CasesFound = len(all)
	if len(all) == 0 {
		log.Printf("[parser-worker] %s — no hearings (%d days)", c.Subdomain, len(dates))
		s.touchParsed(task, hadError)
		return
	}

	collected := 0
	hearings := make([]catalog.HearingItem, 0, len(all))
	for _, item := range all {
		hearings = append(hearings, catalog.HearingItem{
			CaseNumber:  item.CaseNumber,
			CaseUID:     item.CaseUID,
			Parties:     item.Parties,
			Category:    item.Category,
			Judge:       item.Judge,
			Courtroom:   item.Courtroom,
			HearingTime: item.HearingTime,
			HearingDate: item.HearingDate,
			CaseURL:     item.CaseURL,
		})
	}
	newCount, err := s.store.UpsertHearings(catalog.CourtMeta{
		Subdomain: c.Subdomain,
		Name:      c.Name,
		Region:    c.Region,
	}, hearings)
	if err != nil {
		log.Printf("[parser-worker] upsert error: %v", err)
		s.totalFailed.Add(1)
		hadError = true
	} else {
		collected = newCount
		s.totalParsed.Add(int64(newCount))
	}
	if err := s.store.Save(); err != nil {
		log.Printf("[parser-worker] save error: %v", err)
		s.totalFailed.Add(1)
		hadError = true
	}

	task.CasesParsed += collected
	size, _ := s.store.Stats()
	log.Printf("[parser-worker] %s — saved %d new (catalog=%d)", c.Subdomain, collected, size)
	s.touchParsed(task, hadError)
}

func (s *Scheduler) touchParsed(task *CourtTask, hadError bool) {
	now := time.Now()
	task.LastParsed = now
	s.lastUpdate.Store(now)
	if hadError {
		task.FailCount++
		s.totalFailed.Add(1)
		task.NextScheduled = now.Add(time.Duration(s.cfg.RescheduleErrMin) * time.Minute)
	} else if task.CasesFound == 0 {
		task.FailCount = 0
		task.NextScheduled = now.Add(time.Duration(s.cfg.RescheduleMissMin) * time.Minute)
	} else {
		task.FailCount = 0
		task.NextScheduled = now.Add(time.Duration(s.cfg.RescheduleHitMin) * time.Minute)
	}
}

func (s *Scheduler) TriggerCourt(subdomain string) error {
	task, ok := s.tasks[subdomain]
	if !ok {
		return fmt.Errorf("unknown court: %s", subdomain)
	}
	task.NextScheduled = time.Now()
	s.parseCourt(task)
	return nil
}

func (s *Scheduler) Stats() Stats {
	size, pending := s.store.Stats()
	last := ""
	if v := s.lastCourt.Load(); v != nil {
		last = v.(string)
	}
	updated := time.Now().UTC().Format(time.RFC3339)
	if v := s.lastUpdate.Load(); v != nil {
		updated = v.(time.Time).UTC().Format(time.RFC3339)
	}
	st := Stats{
		Running:       s.running.Load(),
		TotalParsed:   s.totalParsed.Load(),
		TotalFailed:   s.totalFailed.Load(),
		CatalogSize:   size,
		EnrichPending: pending,
		LastCourt:     last,
		LastUpdate:    updated,
		Region:        s.cfg.Region,
		CourtsTotal:   len(s.courts),
		EnrichEnabled: s.cfg.EnrichEnabled,
	}
	if s.enrich != nil {
		e, f, d := s.enrich.StatsSnapshot()
		st.TotalEnriched = e
		st.EnrichFailed = f
		st.TotalDocuments = d
	}
	return st
}
