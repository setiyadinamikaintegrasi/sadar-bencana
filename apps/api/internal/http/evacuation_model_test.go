package http

import "testing"

func validEvacInput() *evacuationLocationInput {
	return &evacuationLocationInput{
		Name: "Titik Kumpul Alun-Alun", LocationType: "titik_kumpul",
		Latitude: -6.2, Longitude: 106.8,
	}
}

func TestValidateEvacuationLocationInputAccepts(t *testing.T) {
	if err := validateEvacuationLocationInput(validEvacInput()); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
}

func TestValidateEvacuationLocationInputRejects(t *testing.T) {
	cases := []func(*evacuationLocationInput){
		func(in *evacuationLocationInput) { in.Name = "  " },
		func(in *evacuationLocationInput) { in.LocationType = "warung" },
		func(in *evacuationLocationInput) { in.Latitude = 91 },
		func(in *evacuationLocationInput) { in.Longitude = -181 },
		func(in *evacuationLocationInput) { c := -1; in.Capacity = &c },
	}
	for i, mutate := range cases {
		in := validEvacInput()
		mutate(in)
		if err := validateEvacuationLocationInput(in); err == nil {
			t.Fatalf("case %d: invalid input accepted: %+v", i, in)
		}
	}
}
