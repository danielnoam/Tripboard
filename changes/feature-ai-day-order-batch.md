### Added
- AI tools can put a day's places in order without inventing times (order_day, or an order on a place). Today, the board and the map's route follow it; times still come first.
- AI tools can make many changes in one go (batch_update): one commit instead of one call per place, and nothing changes if any step fails.

### Fixed
- An AI tool's day view (get_day) called a day of a finished trip "now". Its status is now the trip's against today, and it says whether the day itself is past, today or upcoming.
