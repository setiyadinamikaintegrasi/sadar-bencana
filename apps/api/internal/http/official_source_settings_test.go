package http

import "testing"

func TestApprovedOfficialSourceHosts(t *testing.T) {
	if !approvedSourceHost("bmkg", "data.bmkg.go.id") {
		t.Fatal("BMKG open-data host rejected")
	}
	if !approvedSourceHost("inatews", "rtsp.bmkg.go.id") {
		t.Fatal("official BMKG host rejected")
	}
	if !approvedSourceHost("pvmbg", "magma.esdm.go.id") {
		t.Fatal("official ESDM host rejected")
	}
	if approvedSourceHost("bnpb", "bnpb.go.id.evil.example") {
		t.Fatal("suffix confusion accepted")
	}
	if approvedSourceHost("inarisk", "evil.example") {
		t.Fatal("unofficial host accepted")
	}
}
