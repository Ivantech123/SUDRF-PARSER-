package main



import (

	"log"

	"net/http"

	"os"

	"os/signal"

	"syscall"



	"github.com/a2chatsky/sudrf-parser-worker/internal/api"

	"github.com/a2chatsky/sudrf-parser-worker/internal/catalog"

	"github.com/a2chatsky/sudrf-parser-worker/internal/config"

	"github.com/a2chatsky/sudrf-parser-worker/internal/courts"

	"github.com/a2chatsky/sudrf-parser-worker/internal/nodeclient"

	"github.com/a2chatsky/sudrf-parser-worker/internal/scheduler"

)



func main() {

	cfg := config.Load()

	log.Printf("[parser-worker] starting addr=%s region=%s nodeWriter=%v", cfg.ListenAddr, cfg.Region, cfg.NodeWriter)



	courtList, err := courts.Load(cfg.CourtsPath)

	if err != nil {

		log.Fatalf("courts registry: %v", err)

	}



	var backend catalog.Backend

	if cfg.NodeWriter && cfg.NodeURL != "" {

		nc := nodeclient.New(cfg.NodeURL, cfg.Region)

		if err := nc.ReloadIfChanged(); err != nil {

			log.Printf("[parser-worker] node stats warning: %v", err)

		}

		backend = nc

		log.Printf("[parser-worker] catalog via Node API %s (no local JSON load)", cfg.NodeURL)

	} else {

		store, err := catalog.Open(cfg.CasesPath)

		if err != nil {

			log.Fatalf("catalog: %v", err)

		}

		backend = store

	}



	sched := scheduler.New(cfg, backend, courtList)

	sched.Start()



	srv := api.New(sched)

	httpServer := &http.Server{

		Addr:    cfg.ListenAddr,

		Handler: srv.Handler(),

	}



	go func() {

		log.Printf("[parser-worker] HTTP listening on %s", cfg.ListenAddr)

		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {

			log.Fatalf("http: %v", err)

		}

	}()



	ch := make(chan os.Signal, 1)

	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)

	<-ch

	log.Println("[parser-worker] shutting down...")

	sched.Stop()

	_ = backend.Save()

}

