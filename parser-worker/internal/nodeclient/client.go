package nodeclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/a2chatsky/sudrf-parser-worker/internal/catalog"
)

// Client — Node single-writer backend; avoids loading cases-store.json in Go RAM.
type Client struct {
	baseURL string
	region  string
	http    *http.Client

	mu            sync.Mutex
	cachedSize    int
	cachedPending int
}

func New(baseURL, region string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		region:  region,
		http:    &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *Client) UpsertHearings(court catalog.CourtMeta, items []catalog.HearingItem) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	body, _ := json.Marshal(map[string]any{
		"court": map[string]string{
			"subdomain": court.Subdomain,
			"name":      court.Name,
			"region":    court.Region,
		},
		"hearings": items,
	})
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api/internal/upsert-hearing", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("upsert-hearing status=%d body=%s", resp.StatusCode, string(raw))
	}
	var out struct {
		NewCount    int `json:"newCount"`
		CatalogSize int `json:"catalogSize"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return 0, err
	}
	c.mu.Lock()
	c.cachedSize = out.CatalogSize
	c.mu.Unlock()
	return out.NewCount, nil
}

func (c *Client) Save() error { return nil }

func (c *Client) ReloadIfChanged() error {
	size, pending, err := c.fetchStats()
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.cachedSize = size
	c.cachedPending = pending
	c.mu.Unlock()
	return nil
}

func (c *Client) Stats() (size, pending int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cachedSize, c.cachedPending
}

func (c *Client) ListPending(region string, limit int) []*catalog.Case {
	if region == "" {
		region = c.region
	}
	url := fmt.Sprintf("%s/api/internal/pending-enrich?region=%s&limit=%d", c.baseURL, region, limit)
	resp, err := c.http.Get(url)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	var out struct {
		Cases []struct {
			ID             string `json:"id"`
			CaseNumber     string `json:"caseNumber"`
			CourtSubdomain string `json:"courtSubdomain"`
			CaseURL        string `json:"caseUrl"`
		} `json:"cases"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil
	}
	rows := make([]*catalog.Case, 0, len(out.Cases))
	for _, row := range out.Cases {
		rows = append(rows, &catalog.Case{
			ID:             row.ID,
			CaseNumber:     row.CaseNumber,
			CourtSubdomain: row.CourtSubdomain,
			CaseURL:        row.CaseURL,
		})
	}
	return rows
}

func (c *Client) Path() string { return "node:" + c.baseURL }

func (c *Client) fetchStats() (size, pending int, err error) {
	url := fmt.Sprintf("%s/api/internal/catalog-stats?region=%s", c.baseURL, c.region)
	resp, err := c.http.Get(url)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		return 0, 0, fmt.Errorf("catalog-stats status=%d body=%s", resp.StatusCode, string(raw))
	}
	var out struct {
		Size    int `json:"size"`
		Pending int `json:"pending"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, 0, err
	}
	return out.Size, out.Pending, nil
}

var _ catalog.Backend = (*Client)(nil)
