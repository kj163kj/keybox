package domain

import "testing"

func TestGuestDownloadMatrix(t *testing.T) {
	for _, global := range []bool{false, true} {
		for _, policy := range []string{"inherit", "allowed", "denied"} {
			want := global && policy != "denied"
			if DownloadAllowed(global, policy, "public", false) != want {
				t.Fatalf("global=%v policy=%s", global, policy)
			}
			if DownloadAllowed(global, policy, "hidden", false) || DownloadAllowed(global, policy, "public", true) {
				t.Fatal("visibility bypass")
			}
		}
	}
	if DownloadAllowed(true, "corrupt", "public", false) {
		t.Fatal("unknown policy must fail closed")
	}
}
