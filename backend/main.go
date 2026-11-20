// Command server is the Future-Study HTTP API. It reads CISC.CORE in Snowflake and serves
// the built React app from ../frontend/dist so the whole app runs on one port.
package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	sf "github.com/snowflakedb/gosnowflake"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// openSnowflake builds a connection from environment variables. Credentials are never read
// from files in the repo. OAuth (SNOWFLAKE_TOKEN_FILE_PATH) is used when present, else password.
func openSnowflake() (*sql.DB, error) {
	cfg := &sf.Config{
		Account:   env("SNOWFLAKE_ACCOUNT", ""),
		User:      env("SNOWFLAKE_USER", os.Getenv("SNOWFLAKE_USERNAME")),
		Warehouse: env("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
		Role:      os.Getenv("SNOWFLAKE_ROLE"),
		Database:  env("SNOWFLAKE_DATABASE", "CISC"),
		Schema:    env("SNOWFLAKE_SCHEMA", "CORE"),
		Host:      os.Getenv("SNOWFLAKE_HOST"),
	}
	if path := os.Getenv("SNOWFLAKE_TOKEN_FILE_PATH"); path != "" {
		if tok, err := os.ReadFile(path); err == nil {
			cfg.Authenticator = sf.AuthTypeOAuth
			cfg.Token = strings.TrimSpace(string(tok))
		}
	}
	if cfg.Authenticator != sf.AuthTypeOAuth {
		cfg.Password = os.Getenv("SNOWFLAKE_PASSWORD")
	}
	dsn, err := sf.DSN(cfg)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("snowflake", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

func main() {
	db, err := openSnowflake()
	if err != nil {
		log.Fatalf("snowflake config: %v", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatalf("snowflake connect: %v", err)
	}
	a := &api{db: db, model: env("CORTEX_MODEL", "claude-sonnet-4-5")}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/courses", a.listCourses)
	mux.HandleFunc("GET /api/courses/{code}", a.getCourse)
	mux.HandleFunc("GET /api/programs", a.listPrograms)
	mux.HandleFunc("GET /api/programs/{id}", a.getProgram)
	mux.HandleFunc("GET /api/graph", a.graph)
	mux.HandleFunc("GET /api/careers", a.careers)
	mux.HandleFunc("GET /api/search", a.search)
	mux.HandleFunc("POST /api/recommend", a.recommend)

	// Serve the SPA; unknown non-API paths fall back to index.html for client routing.
	dist := env("STATIC_DIR", "../frontend/dist")
	files := http.FileServer(http.Dir(dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(dist + r.URL.Path); err != nil || r.URL.Path == "/" {
			http.ServeFile(w, r, dist+"/index.html")
			return
		}
		files.ServeHTTP(w, r)
	})

	addr := ":" + env("PORT", "8000")
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, logRequests(mux)))
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		h.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.RequestURI(), time.Since(t).Round(time.Millisecond))
		}
	})
}
