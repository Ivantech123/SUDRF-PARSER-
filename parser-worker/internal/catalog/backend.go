package catalog

// Backend — catalog read/write for parser-worker (local JSON or Node API).
type Backend interface {
	UpsertHearings(court CourtMeta, items []HearingItem) (newCount int, err error)
	Save() error
	ReloadIfChanged() error
	Stats() (size, pending int)
	ListPending(region string, limit int) []*Case
	Path() string
}

var _ Backend = (*Store)(nil)
