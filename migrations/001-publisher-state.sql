-- Installed host applies migrations verbatim: there is no namespace placeholder.
-- Derived from manifest id togetherweown.growth-publisher and slug growth_publisher.
-- Re-derive and review this literal if either manifest value changes.
CREATE TABLE IF NOT EXISTS "plugin_growth_publisher_c7caceeea3"."publisher_state" (
  company_id TEXT PRIMARY KEY NOT NULL,
  version BIGINT NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  state_json TEXT NOT NULL CHECK (octet_length(state_json) <= 2097152)
);
