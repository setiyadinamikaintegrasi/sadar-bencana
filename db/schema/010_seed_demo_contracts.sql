-- =============================================================================
-- 010_seed_demo_contracts.sql — demo acceptance contracts for map & accumulation
-- Project : Sadar Bencana (Risk Monitor)
-- Engine  : PostgreSQL 16
-- Notes   : Idempotent via ON CONFLICT DO NOTHING.
--           ~52 rows clustered around Jakarta, Surabaya, Bandung, Medan,
--           Palu, Padang, and Lombok.  All periods cover 2026-01-01..2026-12-31.
-- =============================================================================

BEGIN;

INSERT INTO acceptance_contracts
    (contract_no, cedant_name, object_name, object_address, peril, treaty_type, occupancy,
     latitude, longitude, currency, sum_insured, share_pct, share_amount, premium, claim_amount,
     inception_date, expiry_date)
VALUES

-- ─── JAKARTA CLUSTER (~16 rows) ─────────────────────────────────────────────
    ('FAC-2026-0001','PT Asuransi Jasa Indonesia','Menara BNI 46','Jl. Jend. Sudirman, Jakarta','earthquake','facultative','office_highrise',
     -6.2088,106.8210,'IDR',1200000000000,15.0000,180000000000,2700000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0002','PT Asuransi Sinar Mas','Grand Indonesia Mall','Jl. M.H. Thamrin, Jakarta','fire','facultative','retail_mall',
     -6.1952,106.8205,'IDR',800000000000,20.0000,160000000000,2400000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0003','PT Asuransi Astra Buana','Kawasan Industri Pulogadung','Jakarta Timur','flood','treaty','industrial',
     -6.1830,106.9000,'IDR',500000000000,25.0000,125000000000,1800000000,5000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0010','PT Asuransi Central Asia','Apartemen Kemang','Jakarta Selatan','windstorm','facultative','residential_highrise',
     -6.2600,106.8130,'IDR',250000000000,28.0000,70000000000,1200000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0011','PT Asuransi Jasa Indonesia','Gedung Wisma 46','Jl. Jend. Sudirman Kav 22-23, Jakarta','earthquake','facultative','office_highrise',
     -6.2075,106.8220,'IDR',950000000000,12.0000,114000000000,1900000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0012','PT Asuransi Wahana Tata','PLTU Muara Karang','Jakarta Utara','flood','treaty','power_plant',
     -6.1100,106.7980,'IDR',1500000000000,10.0000,150000000000,3000000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0013','PT Asuransi Sinar Mas','Taman Anggrek Mall','Jl. Let. Jend. S. Parman, Jakarta Barat','fire','facultative','retail_mall',
     -6.1775,106.7895,'IDR',620000000000,22.0000,136400000000,1850000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0014','PT Asuransi Central Asia','Apartemen Pantai Indah Kapuk','Jakarta Utara','windstorm','facultative','residential_highrise',
     -6.1050,106.7700,'IDR',380000000000,30.0000,114000000000,1350000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0015','PT Asuransi Tugu Pratama','Kawasan Industri Cakung','Jakarta Timur','earthquake','treaty','industrial',
     -6.1650,106.9320,'IDR',700000000000,18.0000,126000000000,2100000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0016','PT Asuransi Nasional','Hotel Mulia Senayan','Jl. Asia Afrika, Jakarta Pusat','earthquake','facultative','hotel',
     -6.2188,106.8025,'IDR',430000000000,25.0000,107500000000,1600000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0017','PT Asuransi Astra Buana','Gedung Bursa Efek Indonesia','Jl. Jend. Sudirman Kav 52-53, Jakarta','earthquake','facultative','office_highrise',
     -6.2244,106.8082,'IDR',1100000000000,14.0000,154000000000,2500000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0018','PT Asuransi Wahana Tata','Terminal Tanjung Priok','Jakarta Utara','flood','treaty','port',
     -6.1045,106.8820,'IDR',2000000000000,8.0000,160000000000,3200000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0019','PT Asuransi Sinar Mas','Lippo Mall Puri','Jakarta Barat','fire','facultative','retail_mall',
     -6.1980,106.7410,'IDR',530000000000,20.0000,106000000000,1700000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0020','PT Asuransi Jasa Indonesia','Menara Palma','Jl. H.R. Rasuna Said, Jakarta Selatan','earthquake','facultative','office_highrise',
     -6.2310,106.8310,'IDR',780000000000,16.0000,124800000000,2000000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0021','PT Asuransi Central Asia','Pergudangan Sunter','Jakarta Utara','fire','treaty','warehouse',
     -6.1440,106.8620,'IDR',320000000000,28.0000,89600000000,1300000000,2000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0022','PT Asuransi Tugu Pratama','Komplek Perumahan Gading Serpong','Tangerang (dekat Jakarta)','flood','facultative','residential',
     -6.2400,106.6250,'IDR',280000000000,32.0000,89600000000,1100000000,0,'2026-01-01','2026-12-31'),

-- ─── SURABAYA CLUSTER (~10 rows) ────────────────────────────────────────────
    ('FAC-2026-0004','PT Asuransi Tugu Pratama','Pakuwon Tower','Jl. Embong Malang, Surabaya','earthquake','facultative','office_highrise',
     -7.2650,112.7400,'IDR',650000000000,18.0000,117000000000,1900000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0023','PT Asuransi Sinar Mas','Tunjungan Plaza','Jl. Basuki Rahmat, Surabaya','earthquake','facultative','retail_mall',
     -7.2567,112.7428,'IDR',700000000000,20.0000,140000000000,2100000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0024','PT Asuransi Astra Buana','Kawasan Industri SIER','Surabaya Timur','flood','treaty','industrial',
     -7.3210,112.7930,'IDR',900000000000,15.0000,135000000000,2500000000,7000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0025','PT Asuransi Nasional','Hotel Bumi Surabaya','Jl. Jend. Basuki Rahmat, Surabaya','earthquake','facultative','hotel',
     -7.2580,112.7380,'IDR',290000000000,35.0000,101500000000,1450000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0026','PT Asuransi Wahana Tata','Pelabuhan Tanjung Perak','Surabaya Utara','flood','treaty','port',
     -7.1990,112.7300,'IDR',1800000000000,10.0000,180000000000,3600000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0027','PT Asuransi Central Asia','Ciputra World Surabaya','Jl. Mayjend. Sungkono, Surabaya','fire','facultative','retail_mall',
     -7.2850,112.7170,'IDR',450000000000,22.0000,99000000000,1550000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0028','PT Asuransi Jasa Indonesia','Apartemen Puncak Bukit Golf','Surabaya Barat','windstorm','facultative','residential_highrise',
     -7.2910,112.6880,'IDR',230000000000,30.0000,69000000000,1050000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0029','PT Asuransi Tugu Pratama','Pabrik Rokok Gudang Garam Surabaya','Surabaya','fire','treaty','industrial',
     -7.3350,112.7250,'IDR',550000000000,20.0000,110000000000,1800000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0030','PT Asuransi Sinar Mas','Grand City Surabaya','Jl. Walikota Mustajab, Surabaya','earthquake','facultative','retail_mall',
     -7.2480,112.7550,'IDR',380000000000,18.0000,68400000000,1350000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0031','PT Asuransi Nasional','Gedung BNI Surabaya','Jl. Pemuda, Surabaya','earthquake','facultative','office_highrise',
     -7.2590,112.7490,'IDR',310000000000,25.0000,77500000000,1200000000,0,'2026-01-01','2026-12-31'),

-- ─── BANDUNG CLUSTER (~8 rows) ──────────────────────────────────────────────
    ('FAC-2026-0005','PT Asuransi Wahana Tata','Pabrik Tekstil Bandung','Kab. Bandung','fire','facultative','industrial',
     -6.9175,107.6191,'IDR',300000000000,30.0000,90000000000,1500000000,12000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0032','PT Asuransi Astra Buana','Gedung Sate','Jl. Diponegoro, Bandung','earthquake','facultative','office_government',
     -6.9022,107.6183,'IDR',420000000000,20.0000,84000000000,1600000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0033','PT Asuransi Jasa Indonesia','Kawasan Industri Majalaya','Kab. Bandung','earthquake','treaty','industrial',
     -6.9980,107.7540,'IDR',680000000000,22.0000,149600000000,2200000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0034','PT Asuransi Central Asia','Paris Van Java Mall','Jl. Sukajadi, Bandung','fire','facultative','retail_mall',
     -6.8924,107.5960,'IDR',360000000000,25.0000,90000000000,1300000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0035','PT Asuransi Nasional','Hotel Savoy Homann','Jl. Asia Afrika, Bandung','earthquake','facultative','hotel',
     -6.9198,107.6065,'IDR',190000000000,40.0000,76000000000,1100000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0036','PT Asuransi Tugu Pratama','Pabrik Farmasi Kab. Bandung','Kab. Bandung','fire','treaty','industrial',
     -6.9600,107.6800,'IDR',520000000000,18.0000,93600000000,1700000000,4000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0037','PT Asuransi Wahana Tata','Trans Studio Bandung','Jl. Gatot Subroto, Bandung','windstorm','facultative','entertainment',
     -6.9240,107.6340,'IDR',270000000000,28.0000,75600000000,1000000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0038','PT Asuransi Sinar Mas','Braga City Walk','Jl. Braga, Bandung','fire','facultative','retail_mall',
     -6.9063,107.6081,'IDR',200000000000,30.0000,60000000000,900000000,0,'2026-01-01','2026-12-31'),

-- ─── MEDAN CLUSTER (~7 rows) ────────────────────────────────────────────────
    ('TRT-2026-0009','PT Asuransi Astra Buana','Gudang Logistik Belawan','Medan, Sumatera Utara','flood','treaty','warehouse',
     3.5900,98.6700,'IDR',400000000000,22.0000,88000000000,1600000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0039','PT Asuransi Jasa Indonesia','Sun Plaza Medan','Jl. H. Zainul Arifin, Medan','earthquake','facultative','retail_mall',
     3.5952,98.6795,'IDR',480000000000,20.0000,96000000000,1700000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0040','PT Asuransi Nasional','Pelabuhan Belawan','Medan Utara','flood','treaty','port',
     3.7800,98.7000,'IDR',1600000000000,8.0000,128000000000,2800000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0041','PT Asuransi Central Asia','Hotel Aryaduta Medan','Jl. Kapten Maulana Lubis, Medan','earthquake','facultative','hotel',
     3.5878,98.6764,'IDR',240000000000,35.0000,84000000000,1100000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0042','PT Asuransi Wahana Tata','Kawasan Industri Medan (KIM)','Medan Deli','flood','treaty','industrial',
     3.6150,98.7400,'IDR',750000000000,15.0000,112500000000,2000000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0043','PT Asuransi Tugu Pratama','Gedung Bank Sumut','Jl. Imam Bonjol, Medan','earthquake','facultative','office_highrise',
     3.5843,98.6759,'IDR',185000000000,30.0000,55500000000,900000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0044','PT Asuransi Sinar Mas','Hermes Place Polonia','Jl. Jend. Sudirman, Medan','windstorm','facultative','retail_mall',
     3.5750,98.6710,'IDR',310000000000,22.0000,68200000000,1150000000,0,'2026-01-01','2026-12-31'),

-- ─── PALU / SULAWESI SEISMIC CLUSTER (~5 rows) ──────────────────────────────
    ('FAC-2026-0006','PT Asuransi Nasional','Hotel Santika Palu','Palu, Sulawesi Tengah','earthquake','facultative','hotel',
     -0.9000,119.9000,'IDR',220000000000,40.0000,88000000000,1700000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0045','PT Asuransi Astra Buana','Gedung Perkantoran Palu','Jl. Monginsidi, Palu','earthquake','facultative','office_highrise',
     -0.8870,119.8780,'IDR',175000000000,38.0000,66500000000,1300000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0046','PT Asuransi Jasa Indonesia','Kawasan Industri Palu','Palu Barat','earthquake','treaty','industrial',
     -0.9250,119.8500,'IDR',320000000000,30.0000,96000000000,1800000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0047','PT Asuransi Central Asia','Mal Tatura Palu','Jl. Emy Saelan, Palu','earthquake','facultative','retail_mall',
     -0.9120,119.8920,'IDR',140000000000,42.0000,58800000000,1050000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0048','PT Asuransi Wahana Tata','Komplek Pergudangan Donggala','Donggala, dekat Palu','earthquake','treaty','warehouse',
     -0.6700,119.7500,'IDR',160000000000,35.0000,56000000000,980000000,0,'2026-01-01','2026-12-31'),

-- ─── PADANG / WEST SUMATRA SEISMIC CLUSTER (~4 rows) ────────────────────────
    ('FAC-2026-0007','PT Asuransi Sinar Mas','Plaza Andalas','Padang, Sumatera Barat','earthquake','facultative','retail_mall',
     -0.9500,100.3500,'IDR',180000000000,35.0000,63000000000,1300000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0049','PT Asuransi Tugu Pratama','Hotel Novotel Padang','Jl. Gereja, Padang','earthquake','facultative','hotel',
     -0.9480,100.3620,'IDR',195000000000,38.0000,74100000000,1400000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0050','PT Asuransi Nasional','Kawasan Industri Padang','Padang, Sumatera Barat','earthquake','treaty','industrial',
     -0.9600,100.3310,'IDR',280000000000,32.0000,89600000000,1600000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0051','PT Asuransi Astra Buana','Gedung Bank Nagari','Jl. Pemuda, Padang','earthquake','facultative','office_highrise',
     -0.9398,100.3638,'IDR',145000000000,40.0000,58000000000,1100000000,0,'2026-01-01','2026-12-31'),

-- ─── LOMBOK SEISMIC CLUSTER (~4 rows) ───────────────────────────────────────
    ('FAC-2026-0008','PT Asuransi Jasa Indonesia','Resort Senggigi','Lombok, NTB','earthquake','facultative','hotel',
     -8.6500,116.3200,'IDR',150000000000,45.0000,67500000000,1400000000,8000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0052','PT Asuransi Central Asia','Hotel Sheraton Senggigi','Lombok Barat, NTB','earthquake','facultative','hotel',
     -8.5920,116.0500,'IDR',210000000000,42.0000,88200000000,1550000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0053','PT Asuransi Wahana Tata','Kawasan Ekonomi Khusus Mandalika','Lombok Tengah, NTB','earthquake','treaty','entertainment',
     -8.8980,116.2950,'IDR',850000000000,20.0000,170000000000,3000000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0054','PT Asuransi Tugu Pratama','Bandara Internasional Lombok','Praya, Lombok Tengah','earthquake','facultative','transport',
     -8.7573,116.2769,'IDR',1200000000000,12.0000,144000000000,2600000000,0,'2026-01-01','2026-12-31')

ON CONFLICT (contract_no) DO NOTHING;

COMMIT;

SELECT count(*) AS demo_contracts FROM acceptance_contracts;
