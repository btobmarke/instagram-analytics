-- Migration 019: Ensure services supports google_ads
--
-- 004_phase2_base.sql には service_type の CHECK 制約に google_ads が含まれるが、
-- 既存環境の差異に備えて制約を再定義する。

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_service_type_check;
ALTER TABLE services DROP CONSTRAINT IF EXISTS chk_service_type;

ALTER TABLE services ADD CONSTRAINT services_service_type_check
  CHECK (service_type IN ('instagram', 'gbp', 'line', 'lp', 'ga4', 'clarity', 'google_ads', 'summary', 'x', 'meta_ads', 'owned_media'));

