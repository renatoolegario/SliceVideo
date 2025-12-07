from playwright.sync_api import sync_playwright, expect

def verify_join_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the join page
        page.goto("http://localhost:3000/join")

        # Wait for title to verify page load
        expect(page.get_by_role("heading", name="Smart Video Joiner")).to_be_visible()

        # Check if the button exists
        start_button = page.get_by_role("button", name="Start Join Process")
        expect(start_button).to_be_visible()

        # Take a screenshot
        page.screenshot(path="/home/jules/verification/join_page.png")

        browser.close()

if __name__ == "__main__":
    verify_join_page()
