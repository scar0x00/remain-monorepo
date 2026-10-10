CREATE TABLE clubs (
    club_id INTEGER PRIMARY KEY,
    club_code VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    domestic_competition_id VARCHAR(50),
    total_market_value VARCHAR(50),
    squad_size INTEGER,
    average_age REAL,
    foreigners_number INTEGER,
    foreigners_percentage REAL,
    national_team_players INTEGER,
    stadium_name VARCHAR(255),
    stadium_seats INTEGER,
    net_transfer_record VARCHAR(50),
    coach_name VARCHAR(255),
    last_season INTEGER,
    filename VARCHAR(255),
    url TEXT
);