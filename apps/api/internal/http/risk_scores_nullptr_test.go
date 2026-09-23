package http

import (
	"database/sql"
	"testing"
)

func nullptrTestStrPtr(s string) *string { return &s }

func nullptrTestF64Ptr(f float64) *float64 { return &f }

func TestNullStringPtr(t *testing.T) {
	tests := []struct {
		name  string
		input sql.NullString
		want  *string
	}{
		{
			name:  "NULL returns nil",
			input: sql.NullString{Valid: false},
			want:  nil,
		},
		{
			name:  "valid value returns pointer",
			input: sql.NullString{Valid: true, String: "jakarta"},
			want:  nullptrTestStrPtr("jakarta"),
		},
		{
			name:  "valid empty string returns pointer to empty",
			input: sql.NullString{Valid: true, String: ""},
			want:  nullptrTestStrPtr(""),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nullStringPtr(tt.input)
			if (got == nil) != (tt.want == nil) {
				t.Fatalf("nullStringPtr(%v) = %v, want %v", tt.input, got, tt.want)
			}
			if got != nil && *got != *tt.want {
				t.Fatalf("nullStringPtr(%v) = %q, want %q", tt.input, *got, *tt.want)
			}
		})
	}
}

func TestNullFloat64Ptr(t *testing.T) {
	tests := []struct {
		name  string
		input sql.NullFloat64
		want  *float64
	}{
		{
			name:  "NULL returns nil",
			input: sql.NullFloat64{Valid: false},
			want:  nil,
		},
		{
			name:  "valid value returns pointer",
			input: sql.NullFloat64{Valid: true, Float64: 0.82},
			want:  nullptrTestF64Ptr(0.82),
		},
		{
			name:  "valid zero returns pointer to zero",
			input: sql.NullFloat64{Valid: true, Float64: 0},
			want:  nullptrTestF64Ptr(0),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nullFloat64Ptr(tt.input)
			if (got == nil) != (tt.want == nil) {
				t.Fatalf("nullFloat64Ptr(%v) = %v, want %v", tt.input, got, tt.want)
			}
			if got != nil && *got != *tt.want {
				t.Fatalf("nullFloat64Ptr(%v) = %v, want %v", tt.input, *got, *tt.want)
			}
		})
	}
}
