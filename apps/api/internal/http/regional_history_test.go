package http

import "testing"

func TestAdministrativeCodeValidation(t *testing.T) {
	for _, valid := range []string{"31", "31.71", "31.71.01"} {
		if !administrativeCodePattern.MatchString(valid) {
			t.Fatalf("valid code rejected: %s", valid)
		}
	}
	for _, invalid := range []string{"Jakarta", "31.7", "31.71.01.001", ""} {
		if administrativeCodePattern.MatchString(invalid) {
			t.Fatalf("invalid code accepted: %s", invalid)
		}
	}
}
