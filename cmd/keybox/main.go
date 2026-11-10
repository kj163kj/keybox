package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"keybox/internal/config"
	"keybox/internal/domain"
	"keybox/internal/httpapi"
	"keybox/internal/jobs"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/trust"
	"keybox/internal/validator"
	"keybox/migrations"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		// Even dependency errors (including DSNs/SQL) are not emitted verbatim.
		log.Error("command failed; check configuration, database and documented prerequisites")
		os.Exit(1)
	}
}
func run(log *slog.Logger) error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	dsn := config.Secret("KEYBOX_DB_DSN")
	if dsn == "" {
		return errors.New("database DSN required")
	}
	if command == "migrate-up" {
		return migrations.Up(dsn)
	}
	s, err := store.Open(dsn)
	if err != nil {
		return err
	}
	db, _ := s.DB.DB()
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	switch command {
	case "init-admin":
		username, password := config.Secret("KEYBOX_ADMIN_USERNAME"), config.Secret("KEYBOX_ADMIN_PASSWORD")
		if username == "" || len(username) > 128 || len(password) < 16 || len(password) > 72 {
			return errors.New("admin requires username and 16-72 byte password")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			return err
		}
		admin := store.Admin{ID: domain.NewID(), Username: username, PasswordHash: string(hash), Status: "active", CreatedAt: time.Now().UTC()}
		if err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&admin).Error; err != nil {
				return err
			}
			return s.Audit(tx, store.Actor{AdminID: &admin.ID, RequestID: domain.NewID()}, "admin_bootstrap", "admin", admin.ID, "success", nil)
		}); err != nil {
			return err
		}
		log.Info("admin created", "admin_id", admin.ID)
		return nil
	case "roots-check", "roots-apply", "guest-download-disable":
		return maintenance(ctx, s, command, log)
	case "serve":
	default:
		return errors.New("unknown command")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	vault, err := security.NewVault(cfg.ActiveKey, cfg.EncryptionKeys)
	if err != nil {
		return err
	}
	roots, err := trust.NewRoots(ctx, s)
	if err != nil {
		return err
	}
	crl := &trust.CRL{Store: s, Client: trust.NewHTTPClient(), Now: s.Now, TTL: cfg.CRLTTL, MaxStale: cfg.CRLMaxStale}
	v := &validator.Validator{Now: s.Now, Roots: roots, CRL: crl}
	handler := httpapi.New(&httpapi.Server{Store: s, Vault: vault, Validator: v, Roots: roots, CRL: crl, Config: cfg.HTTP, Log: log})
	server := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	// Explicit TLS termination is required at the reverse proxy.
	signals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	workerDone := make(chan struct{})
	worker := jobs.Worker{Store: s, Roots: roots, CRL: crl, Validator: v, Vault: vault, Log: log}
	go func() { defer close(workerDone); worker.Run(workerCtx) }()
	serveErr := make(chan error, 1)
	go func() { log.Info("HTTP server starting", "address", cfg.Address); serveErr <- server.ListenAndServe() }()
	select {
	case <-signals.Done():
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			stopWorker()
			<-workerDone
			return err
		}
	}
	stopWorker()
	shutdown, finish := context.WithTimeout(context.Background(), 15*time.Second)
	defer finish()
	err = server.Shutdown(shutdown)
	if err != nil {
		_ = server.Close()
	}
	<-workerDone
	return err
}
func maintenance(ctx context.Context, s *store.Store, command string, log *slog.Logger) error {
	if command == "roots-check" {
		flags := flag.NewFlagSet(command, flag.ContinueOnError)
		out := flags.String("out", "", "candidate PEM destination")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		if *out == "" {
			return errors.New("out required")
		}
		bundle, version, err := trust.CheckRootCandidate(ctx, trust.NewHTTPClient(), s.Now())
		if err != nil {
			return err
		}
		file, err := os.OpenFile(*out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = file.Write(bundle)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		log.Info("root candidate saved; approval required", "version", version, "bundle_sha256", validator.Fingerprint(bundle))
		return nil
	}
	var admin store.Admin
	if err := s.DB.WithContext(ctx).Where("username = ? AND status = 'active'", config.Secret("KEYBOX_ADMIN_USERNAME")).Take(&admin).Error; err != nil {
		return errors.New("admin authentication failed")
	}
	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(config.Secret("KEYBOX_ADMIN_PASSWORD"))) != nil {
		return errors.New("admin authentication failed")
	}
	actor := store.Actor{AdminID: &admin.ID, RequestID: domain.NewID()}
	if command == "guest-download-disable" {
		if err := s.SetGuestEnabled(ctx, false, actor); err != nil {
			return err
		}
		log.Info("guest downloads disabled")
		return nil
	}
	roots, err := trust.NewRoots(ctx, s)
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	path := flags.String("file", "", "reviewed root PEM")
	approved := flags.String("sha256", "", "independently reviewed bundle digest")
	if err := flags.Parse(os.Args[2:]); err != nil {
		return err
	}
	raw, err := os.ReadFile(*path)
	if err != nil {
		return err
	}
	if err := roots.Apply(ctx, raw, *approved, actor); err != nil {
		return err
	}
	log.Info("root set applied", "version", roots.Snapshot().Version)
	return nil
}
