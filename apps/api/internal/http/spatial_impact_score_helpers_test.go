package http

import "testing"

func TestGridStepForRadius(t *testing.T) {
	tests := []struct {
		name     string
		radius   float64
		expected float64
	}{
		{"Radius of 1", 1.0, 0.01},
		{"Radius of 500 (Calculated)", 500.0, (500.0 * 2.0 / 111.32) / 400.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := gridStepForRadius(tt.radius)
			// Use a small epsilon for float comparison
			if abs(got-tt.expected) > 0.00001 {
				t.Errorf("GridStepForRadius(%f) = %f; want %f", tt.radius, got, tt.expected)
			}
		})
	}
}

func TestFirstSegment(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"Complex string with multiple parts", "bmkg:bmkg:x", "bmkg"},
		{"Simple string", "polos", "polos"},
		{"Empty string", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := firstSegment(tt.input)
			if got != tt.expected {
				t.Errorf("FirstSegment(%q) = %q; want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestFormatDeg(t *testing.T) {
	tests := []struct {
		name     string
		inputDeg float64
		expected string
	}{
		{"Positive value with precision", 106.84512, "106.8451"},
		{"Negative value", -6.2, "-6.2000"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatDeg(tt.inputDeg)
			if got != tt.expected {
				t.Errorf("FormatDeg(%f) = %q; want %q", tt.inputDeg, got, tt.expected)
			}
		})
	}
}

// Helper function for float absolute value comparison
func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

// NOTE: Assuming these functions are exported/public in spatial_impact_score.go
// and are available in this package (http).
