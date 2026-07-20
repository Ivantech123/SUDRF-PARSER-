package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/a2chatsky/sudrf-parser-worker/internal/scheduler"
)

type Server struct {
	sched *scheduler.Scheduler
}

func New(sched *scheduler.Scheduler) *Server {
	return &Server{sched: sched}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/stats", s.handleStats)
	mux.HandleFunc("/trigger", s.handleTrigger)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "service": "sudrf-parser-worker"})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.sched.Stats())
}

func (s *Server) handleTrigger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	court := strings.TrimSpace(r.URL.Query().Get("court"))
	if court == "" {
		var body struct {
			Court string `json:"court"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		court = strings.TrimSpace(body.Court)
	}
	if court == "" {
		writeJSON(w, map[string]string{"error": "court required"})
		return
	}
	if err := s.sched.TriggerCourt(court); err != nil {
		log.Printf("[api] trigger %s: %v", court, err)
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "court": court, "stats": s.sched.Stats()})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
