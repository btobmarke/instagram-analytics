-- ============================================================
-- LINE Messaging Phase H: 予約（スロットベース MVP）
-- Phase I: Outbound Webhook・外部 API キー
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_booking_services (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  duration_minutes   INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0 AND duration_minutes <= 24 * 60),
  capacity_per_slot  INT NOT NULL DEFAULT 1 CHECK (capacity_per_slot > 0 AND capacity_per_slot <= 100),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_booking_services_line
  ON line_messaging_booking_services (service_id);

CREATE TRIGGER trg_line_messaging_booking_services_updated_at
  BEFORE UPDATE ON line_messaging_booking_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_booking_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_booking_services"
  ON line_messaging_booking_services FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_booking_services"
  ON line_messaging_booking_services FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_booking_slots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_service_id   UUID NOT NULL REFERENCES line_messaging_booking_services(id) ON DELETE CASCADE,
  starts_at            TIMESTAMPTZ NOT NULL,
  ends_at              TIMESTAMPTZ NOT NULL,
  capacity             INT NOT NULL DEFAULT 1 CHECK (capacity > 0),
  booked_count         INT NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_service_id, starts_at)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_booking_slots_starts
  ON line_messaging_booking_slots (booking_service_id, starts_at);

CREATE TRIGGER trg_line_messaging_booking_slots_updated_at
  BEFORE UPDATE ON line_messaging_booking_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_booking_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_booking_slots"
  ON line_messaging_booking_slots FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_booking_slots"
  ON line_messaging_booking_slots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  booking_slot_id    UUID NOT NULL REFERENCES line_messaging_booking_slots(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES line_messaging_contacts(id) ON DELETE SET NULL,
  line_user_id       TEXT,
  guest_name         TEXT,
  guest_phone        TEXT,
  status             TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_bookings_service
  ON line_messaging_bookings (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_messaging_bookings_slot
  ON line_messaging_bookings (booking_slot_id);

CREATE TRIGGER trg_line_messaging_bookings_updated_at
  BEFORE UPDATE ON line_messaging_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_bookings"
  ON line_messaging_bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_bookings"
  ON line_messaging_bookings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Phase I: Outbound Webhook
CREATE TABLE IF NOT EXISTS line_messaging_outbound_webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  target_url      TEXT NOT NULL,
  secret_enc      TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  event_prefixes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_outbound_webhooks_service
  ON line_messaging_outbound_webhooks (service_id);

COMMENT ON COLUMN line_messaging_outbound_webhooks.event_prefixes IS
  '配信する trigger_type のプレフィックス配列。空なら全イベント。例: ["webhook.","form."]';

CREATE TRIGGER trg_line_messaging_outbound_webhooks_updated_at
  BEFORE UPDATE ON line_messaging_outbound_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_outbound_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_outbound_webhooks"
  ON line_messaging_outbound_webhooks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_outbound_webhooks"
  ON line_messaging_outbound_webhooks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Phase I: 外部 API キー（ハッシュのみ保存）
CREATE TABLE IF NOT EXISTS line_messaging_external_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,
  key_hash        TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_ext_api_keys_service
  ON line_messaging_external_api_keys (service_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_ext_api_keys_hash
  ON line_messaging_external_api_keys (key_hash);

ALTER TABLE line_messaging_external_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_external_api_keys"
  ON line_messaging_external_api_keys FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_external_api_keys"
  ON line_messaging_external_api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 予約の原子的な枠確保（booked_count < capacity のときのみ増加して予約行を作成）
CREATE OR REPLACE FUNCTION line_messaging_try_book_slot(
  p_slot_id UUID,
  p_service_id UUID,
  p_contact_id UUID,
  p_line_user_id TEXT,
  p_guest_name TEXT,
  p_guest_phone TEXT,
  p_note TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id UUID;
  v_slot UUID;
BEGIN
  UPDATE line_messaging_booking_slots s
  SET
    booked_count = booked_count + 1,
    updated_at = now()
  FROM line_messaging_booking_services bs
  WHERE s.id = p_slot_id
    AND s.booking_service_id = bs.id
    AND bs.service_id = p_service_id
    AND s.booked_count < s.capacity
  RETURNING s.id INTO v_slot;

  IF v_slot IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO line_messaging_bookings (
    service_id,
    booking_slot_id,
    contact_id,
    line_user_id,
    guest_name,
    guest_phone,
    note,
    status
  )
  VALUES (
    p_service_id,
    p_slot_id,
    p_contact_id,
    NULLIF(trim(p_line_user_id), ''),
    NULLIF(trim(p_guest_name), ''),
    NULLIF(trim(p_guest_phone), ''),
    NULLIF(trim(p_note), ''),
    'confirmed'
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

COMMENT ON FUNCTION line_messaging_try_book_slot IS
  '予約枠が空いていれば booked_count を増やし line_messaging_bookings に 1 行挿入。失敗時は NULL。';

GRANT EXECUTE ON FUNCTION line_messaging_try_book_slot(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION line_messaging_release_booking_slot(p_slot_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE line_messaging_booking_slots
  SET
    booked_count = GREATEST(0, booked_count - 1),
    updated_at = now()
  WHERE id = p_slot_id
    AND booked_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION line_messaging_release_booking_slot(UUID) TO service_role;
