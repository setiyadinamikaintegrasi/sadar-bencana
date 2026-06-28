package http

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeDerivesShareAmount(t *testing.T) {
	c := Contract{SumInsured: 1000, SharePct: 25, Peril: "fire", TreatyType: "facultative",
		Latitude: -6.2, Longitude: 106.8, ContractNo: "X-1"}
	if err := c.normalizeAndValidate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.ShareAmount != 250 {
		t.Fatalf("expected derived share_amount 250, got %v", c.ShareAmount)
	}
}

func TestValidateRejectsBadEnumAndRanges(t *testing.T) {
	bad := []Contract{
		{ContractNo: "", Peril: "fire", TreatyType: "facultative", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "meteor", TreatyType: "facultative", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "xxx", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 100, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 0, Longitude: 200},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 0, Longitude: 0, SharePct: 150},
	}
	for i, c := range bad {
		if err := c.normalizeAndValidate(); err == nil {
			t.Fatalf("case %d: expected validation error, got nil", i)
		}
	}
}

func TestParseContractsCSVSuccess(t *testing.T) {
	csv := strings.Join(contractCSVHeader, ",") + "\n" +
		"C-1,Cedant A,Object A,Addr,earthquake,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n"
	got, err := parseContractsCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].ContractNo != "C-1" || got[0].ShareAmount != 250 {
		t.Fatalf("unexpected parse result: %#v", got)
	}
}

func TestParseContractsCSVRowErrorCarriesRowNumber(t *testing.T) {
	csv := strings.Join(contractCSVHeader, ",") + "\n" +
		"C-1,Cedant A,Object A,Addr,earthquake,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n" +
		"C-2,Cedant B,Object B,Addr,meteor,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n"
	_, err := parseContractsCSV(strings.NewReader(csv))
	var rowErr *csvRowError
	if !errors.As(err, &rowErr) {
		t.Fatalf("expected *csvRowError, got %v", err)
	}
	if rowErr.Row != 2 {
		t.Fatalf("expected row 2, got %d", rowErr.Row)
	}
}
