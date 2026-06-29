package http

import "testing"

func floatPtr(value float64) *float64 { return &value }
func intPtr(value int) *int           { return &value }

func TestValidatePerilThresholds(t *testing.T) {
	valid := &EWSPerilThresholds{
		Earthquake: &EWSEarthquakeThreshold{MinMagnitude: floatPtr(5.5)},
		Flood:      &EWSFloodThreshold{MinDepthCm: floatPtr(150)},
		Volcano:    &EWSVolcanoThreshold{MinActivityLevel: intPtr(3)},
		Wildfire:   &EWSWildfireThreshold{MinFRP: floatPtr(100)},
	}
	if err := validatePerilThresholds(valid); err != nil {
		t.Fatalf("valid thresholds rejected: %v", err)
	}
}

func TestValidatePerilThresholdsRejectsOutOfRangeValues(t *testing.T) {
	tests := []*EWSPerilThresholds{
		{Earthquake: &EWSEarthquakeThreshold{MinMagnitude: floatPtr(11)}},
		{Flood: &EWSFloodThreshold{MinDepthCm: floatPtr(-1)}},
		{Volcano: &EWSVolcanoThreshold{MinActivityLevel: intPtr(5)}},
		{Wildfire: &EWSWildfireThreshold{MinFRP: floatPtr(10001)}},
	}
	for _, thresholds := range tests {
		if err := validatePerilThresholds(thresholds); err == nil {
			t.Fatalf("expected invalid thresholds to be rejected: %#v", thresholds)
		}
	}
}

func TestThresholdsJSONArgPreservesSemanticFields(t *testing.T) {
	thresholds := &EWSPerilThresholds{
		Flood: &EWSFloodThreshold{MinDepthCm: floatPtr(70)},
	}
	value, err := thresholdsJSONArg(thresholds)
	if err != nil {
		t.Fatal(err)
	}
	if value != `{"flood":{"min_depth_cm":70}}` {
		t.Fatalf("unexpected JSON: %v", value)
	}
}
