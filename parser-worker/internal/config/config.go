package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr       string
	CasesPath        string
	CourtsPath       string
	Region           string
	NodeURL          string
	NodeWriter       bool
	ScheduleDays     int
	ScheduleDaysBack int
	ConcurrentCourts  int
	TickIntervalSec   int
	EnrichEnabled    bool
	EnrichPerTick    int
	EnrichConcurrent int
	EnrichDelayMs    int
	RescheduleHitMin int
	RescheduleMissMin int
	RescheduleErrMin int
}

// Default production concurrency (override via env).
const (
	defaultConcurrentCourts = 10
	defaultEnrichPerTick      = 50
	defaultEnrichConcurrent   = 8
)

func Load() Config {
	return Config{
		ListenAddr:        env("PARSER_WORKER_ADDR", ":8090"),
		CasesPath:         env("SUDRF_CASES_PATH", "./cases-store.json"),
		CourtsPath:        env("COURTS_REGISTRY_PATH", "./data/courts-registry.json"),
		Region:            env("PARSER_REGION", env("PARSER_TIER2_REGION", "13")),
		NodeURL:           env("PARSER_NODE_URL", "http://127.0.0.1:8080"),
		NodeWriter:        env("PARSER_NODE_WRITER", "1") == "1",
		ScheduleDays:      envInt("PARSER_SCHEDULE_DAYS", 7),
		ScheduleDaysBack:  envInt("PARSER_SCHEDULE_DAYS_BACK", 0),
		ConcurrentCourts:  envInt("PARSER_CONCURRENT_COURTS", defaultConcurrentCourts),
		TickIntervalSec:   envInt("PARSER_TICK_INTERVAL_SEC", 30),
		EnrichEnabled:     env("PARSER_WORKER_ENRICH", "1") == "1",
		EnrichPerTick:     envInt("PARSER_ENRICH_QUEUE", defaultEnrichPerTick),
		EnrichConcurrent:  envInt("PARSER_ENRICH_CONCURRENT", defaultEnrichConcurrent),
		EnrichDelayMs:     envInt("PARSER_ENRICH_DELAY_MS", 800),
		RescheduleHitMin:  envInt("PARSER_RESCHEDULE_HIT", 10),
		RescheduleMissMin: envInt("PARSER_RESCHEDULE_MISS", 20),
		RescheduleErrMin:  envInt("PARSER_RESCHEDULE_ERROR", 15),
	}
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
