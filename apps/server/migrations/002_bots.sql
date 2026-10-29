-- Computer players are ordinary user rows with the id of their engine. They cannot log in.
ALTER TABLE users ADD COLUMN bot TEXT;
