package migrations

import (
	"database/sql"
	"embed"
	"errors"

	driver "github.com/go-sql-driver/mysql"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/mysql"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var Files embed.FS

func Up(dsn string) error {
	cfg, err := driver.ParseDSN(dsn)
	if err != nil {
		return errors.New("invalid migration DSN")
	}
	cfg.MultiStatements = true
	cfg.ParseTime = true
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return errors.New("migration database unavailable")
	}
	defer db.Close()
	drv, err := mysql.WithInstance(db, &mysql.Config{})
	if err != nil {
		return errors.New("migration driver unavailable")
	}
	src, err := iofs.New(Files, ".")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithInstance("iofs", src, "mysql", drv)
	if err != nil {
		return err
	}
	defer m.Close()
	err = m.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}
