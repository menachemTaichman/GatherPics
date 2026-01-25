# Load Testing with Locust

This directory contains a Locust load testing script for the face-recognition-website.

## Installation

Install Locust (if not already installed):
```bash
pip install locust>=2.0.0
```

Or install from requirements.txt:
```bash
pip install -r requirements.txt
```

## Configuration

You can set environment variables in two ways:

### Option 1: Using .env file (Recommended)

Create or edit `.env` file in the project root:

```bash
# Server URL (can be IP address or domain)
LOCUST_HOST=https://gatherpics.com
# Or for local testing:
# LOCUST_HOST=http://localhost:5000

# Test user credentials
TEST_USER_LABEL=your_username
TEST_USER_PASSWORD=your_password

# Optional: Test specific event (if not set, will discover from API)
TEST_EVENT_ID=your-event-id
```

The script will automatically load these from `.env` file.

### Option 2: Export environment variables

```bash
# Required: Server URL (can be IP address or domain)
export LOCUST_HOST=http://your-server-ip:5000
# Or for production:
# export LOCUST_HOST=https://gatherpics.com

# Required: Test user credentials
export TEST_USER_LABEL=your_username
export TEST_USER_PASSWORD=your_password

# Optional: Test specific event (if not set, will discover from API)
export TEST_EVENT_ID=your-event-id
```

**Note**: If `LOCUST_HOST` is set in `.env`, you can omit the `--host` flag when running Locust. Otherwise, use `--host` flag or it will be loaded from environment.

## Running the Load Test

### Basic Usage

```bash
# If LOCUST_HOST is set in .env file, you can omit --host flag:
locust -f tests/load_test.py

# Or explicitly set host:
locust -f tests/load_test.py --host=$LOCUST_HOST
# Or:
locust -f tests/load_test.py --host=https://gatherpics.com
```

Then open http://localhost:8089 in your browser to configure and start the test.

### Command Line (Headless Mode)

```bash
# Run with 100 users, spawn rate of 10 users/second, for 5 minutes
locust -f tests/load_test.py \
  --host=$LOCUST_HOST \
  --users 100 \
  --spawn-rate 10 \
  --run-time 5m \
  --headless \
  --html report.html
```

### Advanced Options

```bash
# Run with specific number of users and spawn rate
locust -f tests/load_test.py --host=$LOCUST_HOST --users 50 --spawn-rate 5

# Run for a specific duration
locust -f tests/load_test.py --host=$LOCUST_HOST --users 100 --spawn-rate 10 --run-time 10m

# Save results to HTML report
locust -f tests/load_test.py --host=$LOCUST_HOST --users 100 --spawn-rate 10 --html load_test_report.html

# Run on multiple workers (distributed load testing)
# Terminal 1 (master):
locust -f tests/load_test.py --host=$LOCUST_HOST --master

# Terminal 2-N (workers):
locust -f tests/load_test.py --host=$LOCUST_HOST --worker --master-host=localhost
```

## What the Test Does

The load test simulates real user behavior following the typical flow:

1. **Login**: Each virtual user logs in once at the start
2. **Get Event**: User gets URL for specific event (if `TEST_EVENT_ID` is set, uses that; otherwise discovers from API)
3. **Get Profile**: User gets their current profile
4. **Browse Moments Page**: High frequency - simulates going to MomentsPage (get moments, then get all images)
5. **Get All Images**: High frequency - loads all images for the event (as MomentsPage does)
6. **Get Image**: Medium frequency - views a specific image (simulates clicking on an image)
7. **Get Groups**: Medium frequency - lists all groups
8. **Get Group**: Medium frequency - views a specific group with its images and faces (simulates clicking on a group)
9. **Get Events**: Lower frequency - lists all events
10. **Get Event**: Lower frequency - gets specific event details
11. **Get Albums**: Lower frequency - lists albums
12. **Get Moments**: Lower frequency - lists moments
13. **Get Profile**: Lower frequency - gets user profile

The test automatically:
- Sets the `Host: gatherpics.com` header (for Caddy routing)
- Handles JWT authentication (access token + refresh token cookies)
- Caches event ID, image IDs, and group IDs for efficient testing
- Extracts IDs from responses to make realistic API calls
- Handles errors gracefully (skips tasks if data is unavailable)
- Supports testing a specific event via `TEST_EVENT_ID` environment variable

## Task Weights

Tasks are weighted by frequency (higher number = more frequent):
- `browse_moments_page`: weight 3 (most frequent - simulates MomentsPage)
- `get_all_images`: weight 3 (high frequency - loads all images)
- `get_image`: weight 2 (medium frequency - view specific image)
- `get_groups`: weight 2 (medium frequency - list groups)
- `get_group`: weight 2 (medium frequency - view specific group)
- `get_events`: weight 1 (lower frequency)
- `get_event`: weight 1 (lower frequency)
- `get_profile`: weight 1 (lower frequency)
- `get_albums`: weight 1 (lower frequency)
- `get_moments`: weight 1 (lower frequency)

## Customization

Edit `tests/load_test.py` to:
- Adjust task weights (change the `@task(N)` numbers)
- Add more endpoints to test
- Modify wait times between requests
- Change the Host header value
- Add custom metrics or logging

## Tips

1. **Start Small**: Begin with a small number of users (10-20) to verify everything works
2. **Monitor Resources**: Watch server CPU, memory, and database connections during tests
3. **Use Distributed Mode**: For high load, use multiple worker processes
4. **Test Realistic Scenarios**: Adjust task weights to match your actual user behavior patterns
5. **Check Logs**: Monitor server logs for errors during load testing

## Troubleshooting

**Login fails:**
- Verify `TEST_USER_LABEL` and `TEST_USER_PASSWORD` are correct
- Check that the server is accessible at `LOCUST_HOST`
- Ensure the user account exists and is active

**Connection errors:**
- Verify `LOCUST_HOST` is correct (include http:// or https://)
- Check firewall/network settings
- Ensure the server is running and accessible

**401 Unauthorized errors:**
- Token might have expired - the script should handle refresh tokens automatically
- Check that cookies are being sent (Locust handles this automatically)
