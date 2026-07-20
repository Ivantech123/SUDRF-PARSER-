package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Document struct {
	DocID      string `json:"docId,omitempty"`
	Name       string `json:"name,omitempty"`
	Date       string `json:"date,omitempty"`
	CaseNumber string `json:"caseNumber,omitempty"`
	URL        string `json:"url,omitempty"`
	Text       string `json:"text,omitempty"`
	HasText    bool   `json:"hasText,omitempty"`
}

type Case struct {
	ID              string     `json:"id"`
	CaseUID         string     `json:"caseUid,omitempty"`
	CaseNumber      string     `json:"caseNumber"`
	CourtSubdomain  string     `json:"courtSubdomain"`
	CourtName       string     `json:"courtName"`
	CourtRegion     string     `json:"courtRegion,omitempty"`
	Category        string     `json:"category"`
	Parties         string     `json:"parties,omitempty"`
	Plaintiff       string     `json:"plaintiff,omitempty"`
	Defendant       string     `json:"defendant,omitempty"`
	Judge           string     `json:"judge,omitempty"`
	Status          string     `json:"status,omitempty"`
	HearingDate     string     `json:"hearingDate,omitempty"`
	HearingTime     string     `json:"hearingTime,omitempty"`
	Courtroom       string     `json:"courtroom,omitempty"`
	CaseURL         string     `json:"caseUrl,omitempty"`
	DocumentsCount  int        `json:"documentsCount"`
	HasActText      bool       `json:"hasActText"`
	Documents       []Document `json:"documents"`
	CollectedAt     string     `json:"collectedAt"`
	EnrichedAt      string     `json:"enrichedAt,omitempty"`
}

type storeShape struct {
	Version int              `json:"version"`
	Cases   map[string]*Case `json:"cases"`
}

type Store struct {
	path  string
	mu    sync.Mutex
	cases map[string]*Case
	dirty bool
}

func Open(path string) (*Store, error) {
	s := &Store{path: path, cases: map[string]*Case{}}
	if err := s.reload(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) Size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.cases)
}

func (s *Store) reload() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var data storeShape
	if err := json.Unmarshal(raw, &data); err != nil {
		return err
	}
	if data.Cases == nil {
		data.Cases = map[string]*Case{}
	}
	s.cases = data.Cases
	s.dirty = false
	return nil
}

func (s *Store) ReloadIfChanged() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := os.Stat(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var data storeShape
	if err := json.Unmarshal(raw, &data); err != nil {
		return err
	}
	if data.Cases == nil {
		data.Cases = map[string]*Case{}
	}
	s.cases = data.Cases
	s.dirty = false
	_ = info
	return nil
}

func caseID(subdomain string, caseUID, caseNumber string) string {
	if caseUID != "" {
		return caseUID
	}
	return subdomain + ":" + caseNumber
}

func splitParties(parties string) (plaintiff, defendant string) {
	if strings.TrimSpace(parties) == "" {
		return "", ""
	}
	parts := strings.FieldsFunc(parties, func(r rune) bool {
		return r == ';' || r == '/' || r == '|'
	})
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	if len(parts) >= 2 {
		return parts[0], parts[1]
	}
	return strings.TrimSpace(parties), ""
}

type HearingItem struct {
	CaseNumber  string
	CaseUID     string
	Parties     string
	Category    string
	Judge       string
	Courtroom   string
	HearingTime string
	HearingDate string
	CaseURL     string
}

type CourtMeta struct {
	Subdomain string
	Name      string
	Region    string
}

// UpsertFromHearing mirrors Node CaseCatalog.upsertFromHearing. Returns true if new.
func (s *Store) UpsertFromHearing(court CourtMeta, item HearingItem) (bool, error) {
	if strings.TrimSpace(item.CaseNumber) == "" {
		return false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	id := caseID(court.Subdomain, item.CaseUID, item.CaseNumber)
	existing := s.cases[id]
	plaintiff, defendant := splitParties(item.Parties)

	row := &Case{
		ID:             id,
		CaseUID:        pickStr(item.CaseUID, existingCaseUID(existing)),
		CaseNumber:     item.CaseNumber,
		CourtSubdomain: court.Subdomain,
		CourtName:      court.Name,
		CourtRegion:    court.Region,
		Category:       pickStr(item.Category, existingStr(existing, func(c *Case) string { return c.Category }), "Не указано"),
		Parties:        pickStr(item.Parties, existingStr(existing, func(c *Case) string { return c.Parties })),
		Plaintiff:      pickStr(plaintiff, existingStr(existing, func(c *Case) string { return c.Plaintiff })),
		Defendant:      pickStr(defendant, existingStr(existing, func(c *Case) string { return c.Defendant })),
		Judge:          pickStr(item.Judge, existingStr(existing, func(c *Case) string { return c.Judge })),
		Status:         pickStr(existingStr(existing, func(c *Case) string { return c.Status }), "Заседание"),
		HearingDate:    pickStr(item.HearingDate, existingStr(existing, func(c *Case) string { return c.HearingDate })),
		HearingTime:    pickStr(item.HearingTime, existingStr(existing, func(c *Case) string { return c.HearingTime })),
		Courtroom:      pickStr(item.Courtroom, existingStr(existing, func(c *Case) string { return c.Courtroom })),
		CaseURL:        pickStr(item.CaseURL, existingStr(existing, func(c *Case) string { return c.CaseURL })),
		DocumentsCount: existingInt(existing, func(c *Case) int { return c.DocumentsCount }),
		HasActText:     existingBool(existing, func(c *Case) bool { return c.HasActText }),
		Documents:      existingDocs(existing),
		CollectedAt:    pickStr(existingStr(existing, func(c *Case) string { return c.CollectedAt }), time.Now().UTC().Format(time.RFC3339)),
		EnrichedAt:     existingStr(existing, func(c *Case) string { return c.EnrichedAt }),
	}

	isNew := existing == nil
	s.cases[id] = row
	s.dirty = true
	return isNew, nil
}

// UpsertHearings ingests a court schedule batch; returns count of new cases.
func (s *Store) UpsertHearings(court CourtMeta, items []HearingItem) (int, error) {
	n := 0
	for _, item := range items {
		isNew, err := s.UpsertFromHearing(court, item)
		if err != nil {
			return n, err
		}
		if isNew {
			n++
		}
	}
	return n, nil
}

func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	payload := storeShape{Version: 1, Cases: s.cases}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

func (s *Store) WithLock(fn func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return fn()
}

func (s *Store) Stats() (size, pending int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.cases {
		if c.CaseURL != "" && c.EnrichedAt == "" {
			pending++
		}
	}
	return len(s.cases), pending
}

func pickStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func existingCaseUID(c *Case) string {
	if c == nil {
		return ""
	}
	return c.CaseUID
}

func existingStr(c *Case, f func(*Case) string) string {
	if c == nil {
		return ""
	}
	return f(c)
}

func existingInt(c *Case, f func(*Case) int) int {
	if c == nil {
		return 0
	}
	return f(c)
}

func existingBool(c *Case, f func(*Case) bool) bool {
	if c == nil {
		return false
	}
	return f(c)
}

func existingDocs(c *Case) []Document {
	if c == nil || c.Documents == nil {
		return []Document{}
	}
	return c.Documents
}

func (s *Store) ListPending(region string, limit int) []*Case {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 {
		limit = 20
	}
	type pair struct {
		at  string
		c   *Case
	}
	var rows []pair
	for _, c := range s.cases {
		if c.CaseURL == "" || c.EnrichedAt != "" {
			continue
		}
		if region != "" && c.CourtRegion != region {
			continue
		}
		rows = append(rows, pair{at: c.CollectedAt, c: c})
	}
	// sort by collectedAt asc (oldest first)
	for i := 1; i < len(rows); i++ {
		j := i
		for j > 0 && rows[j].at < rows[j-1].at {
			rows[j], rows[j-1] = rows[j-1], rows[j]
			j--
		}
	}
	if len(rows) > limit {
		rows = rows[:limit]
	}
	out := make([]*Case, len(rows))
	for i, p := range rows {
		out[i] = p.c
	}
	return out
}

func (s *Store) Path() string { return s.path }

func (s *Store) String() string {
	n, p := s.Stats()
	return fmt.Sprintf("catalog=%d pending=%d path=%s", n, p, s.path)
}
