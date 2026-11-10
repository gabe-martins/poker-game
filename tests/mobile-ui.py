"""Browser regression checks. Requires Python Playwright and Chromium.

Run: python3 tests/mobile-ui.py
Screenshots are saved under /tmp/poker-mobile-preview.
"""
import json
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path("/tmp/poker-mobile-preview")
OUTPUT.mkdir(exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT.parent)))
Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"

# A deterministic fixture keeps bot timers from changing the layout mid-check.
FIXTURE = """
document.addEventListener('DOMContentLoaded', () => {
    PokerGame.prototype._checkAndTriggerAIAction = function() {};
    const original = PokerGame.prototype._triggerUIUpdate;
    PokerGame.prototype._triggerUIUpdate = function() {
        window.testGame = this;
        original.call(this);
    };
});
"""
HUMAN_TURN = """
() => {
    const g = window.testGame;
    g.currentPlayerIndex = 0;
    g._actionPending = false;
    g.players[0].status = 'active';
    g._triggerUIUpdate();
}
"""
FIVE_CARD_BOARD = """
() => {
    const g = window.testGame;
    g.communityCards = ['AH', 'KD', 'QC', 'JS', 'TH'].map(c => new Card(c[1], c[0]));
    g._triggerUIUpdate();
}
"""

def bounds(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
    rectangles = []
    for selector in ["#player-0", "#player-1", "#player-2", "#player-3", "#table-center"]:
        rect = page.locator(selector).bounding_box()
        assert rect["x"] >= 0 and rect["x"] + rect["width"] <= page.viewport_size["width"] + 1, selector
        rectangles.append((selector, rect))
    for i, (a_name, a) in enumerate(rectangles):
        for b_name, b in rectangles[i+1:]:
            overlap_x = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
            overlap_y = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
            assert overlap_x <= 1 or overlap_y <= 1, f"{a_name} overlaps {b_name}"
    for button in page.locator("#controls-container button, #rules-button").all():
        rect = button.bounding_box()
        assert rect["height"] >= 44 and rect["width"] >= 44, "Touch target too small"

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium"),
        args=["--no-sandbox"])
    for width, height in [(320, 568), (360, 740), (390, 844), (430, 932), (768, 1024), (844, 390), (1280, 800)]:
        context = browser.new_context(viewport={"width": width, "height": height}, has_touch=width < 900)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(FIXTURE)
        page.goto(URL)
        page.wait_for_function("window.testGame && document.querySelector('#player-0 .playing-card')")
        page.evaluate(HUMAN_TURN)
        page.wait_for_function("!document.querySelector('#btn-check-call').disabled")
        page.evaluate(FIVE_CARD_BOARD)
        page.wait_for_function("document.querySelectorAll('#community-cards .playing-card').length === 5")
        bounds(page)
        assert page.locator("#player-1 .card-back").count() == 2
        assert page.locator("#player-0 .red-suit, #player-0 .playing-card").count() >= 2
        assert page.locator("#community-cards [role=img]").count() == 5
        assert not page.locator("#poker-table img").count(), "Game cards must not need image downloads"
        page.screenshot(path=str(OUTPUT / f"poker-{width}.png"), full_page=True)
        page.locator("#bet-amount").fill("1")
        page.locator("#btn-bet-raise").click()
        assert "mínimo" in page.locator("#action-error").inner_text()
        assert page.evaluate("testGame.players[0].totalBetInRound") == 0
        page.locator("#bet-amount").fill("1001")
        page.locator("#btn-bet-raise").click()
        assert "até" in page.locator("#action-error").inner_text()
        assert page.evaluate("testGame.players[0].totalBetInRound") == 0
        page.locator("#bet-amount").fill("60")
        page.locator("#btn-bet-raise").click()
        page.wait_for_function("testGame.players[0].totalBetInRound === 60")
        assert page.evaluate("testGame.players[0].chips") == 940
        page.locator("#history-panel summary").click()
        assert page.locator("#game-log").is_visible()
        page.evaluate("""() => {
            const g = testGame; g.currentPhase = 'showdown';
            g.players.forEach(p => { p.evaluationResult = {description: 'Straight Flush (Ace high)'}; });
            g._triggerUIUpdate();
        }""")
        page.wait_for_function("document.querySelector('#phase-label').textContent === 'Resultado'")
        bounds(page)
        assert not errors, errors
        print(json.dumps({"viewport": [width, height], "layout": "pass", "betting": "pass"}))
        context.close()
    browser.close()
server.shutdown()
