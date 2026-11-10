package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestOpenAPIExactlyMatchesRegisteredRoutes(t *testing.T) {
	raw, err := os.ReadFile("../../api/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	routes := New(&Server{}).(chi.Routes)
	seen := map[string]bool{}
	err = chi.Walk(routes, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		method = strings.ToLower(method)
		if _, ok := spec.Paths[route][method]; !ok {
			t.Errorf("missing OpenAPI operation %s %s", method, route)
		}
		seen[method+" "+route] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for path, methods := range spec.Paths {
		for method := range methods {
			if !seen[method+" "+path] {
				t.Errorf("documented unimplemented route %s %s", method, path)
			}
		}
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	var walk func(any)
	walk = func(node any) {
		switch n := node.(type) {
		case map[string]any:
			if target, ok := n["$ref"].(string); ok {
				if !strings.HasPrefix(target, "#/") {
					t.Fatalf("external contract ref: %s", target)
				}
				cursor := doc
				for _, part := range strings.Split(strings.TrimPrefix(target, "#/"), "/") {
					object, ok := cursor.(map[string]any)
					if !ok {
						t.Fatalf("broken ref: %s", target)
					}
					cursor, ok = object[part]
					if !ok {
						t.Fatalf("missing ref: %s", target)
					}
				}
			}
			for _, child := range n {
				walk(child)
			}
		case []any:
			for _, child := range n {
				walk(child)
			}
		}
	}
	walk(doc)
}
