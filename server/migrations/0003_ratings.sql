ALTER TABLE "game_players" ADD COLUMN "rating_before" integer;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "rating_after" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rating" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rated_games" integer DEFAULT 0 NOT NULL;