CREATE TABLE invites (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL,
	email text DEFAULT '' NOT NULL,
	max_guests bigint DEFAULT 1 NOT NULL,
	status text DEFAULT 'pending' NOT NULL,
	guests bigint DEFAULT 0 NOT NULL,
	guest_names text DEFAULT '' NOT NULL,
	note text DEFAULT '' NOT NULL,
	updated text NOT NULL
);
--> statement-breakpoint
CREATE TABLE limits (
	key text PRIMARY KEY NOT NULL,
	count bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE photos (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL,
	caption text DEFAULT '' NOT NULL,
	size bigint NOT NULL,
	state text DEFAULT 'pending' NOT NULL,
	created text NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
	key text PRIMARY KEY NOT NULL,
	value text NOT NULL
);
