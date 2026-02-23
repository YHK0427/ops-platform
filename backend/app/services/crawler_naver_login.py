import asyncio
import logging
from datetime import datetime, timezone

from playwright.async_api import async_playwright
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.naver_session import import_session

logger = logging.getLogger(__name__)

async def login_with_credentials(db: AsyncSession, username: str, password: str):
    """
    Automates Naver login using provided credentials.
    """
    logger.info(f"Starting automated login for user: {username}")
    
    async with async_playwright() as p:
        # Launch browser (Headless=True is preferred for server, but Naver might detect it.
        # We'll try headless=True first. If it fails often, we might need False + Xvfb).
        try:
            browser = await p.chromium.launch(headless=True)
        except Exception as e:
            logger.error(f"Failed to launch browser: {e}")
            return {"status": "failed", "reason": f"Browser error: {str(e)}"}

        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            await page.goto("https://nid.naver.com/nidlogin.login")
            
            # Naver often blocks direct typing. We use clipboard copy-paste emulation via JS if possible,
            # but for now, let's try standard fill. 
            # Note: Naver CAPTCHA is triggered easily by typing speed.
            
            # Method 1: JS Value Setting (Bypasses typing detection sometimes)
            await page.evaluate(f"document.getElementById('id').value = '{username}'")
            await page.evaluate(f"document.getElementById('pw').value = '{password}'")
            
            # Click Login
            await page.click(".btn_login")
            
            # Wait for navigation or cookie
            # Success indicator: NID_SES cookie or URL change to www.naver.com / error message
            logger.info("Waiting for login result...")
            
            try:
                # Wait for either success (cookie/redirect) or failure (error message)
                # We poll cookies or URL
                for _ in range(15): # Increase timeout slightly
                    cookies = await context.cookies()
                    nid_ses = next((c for c in cookies if c["name"] == "NID_SES"), None)
                    if nid_ses:
                        logger.info("Login Successful!")
                        break
                    
                    # NEW: Handle Device Confirmation Screen
                    if "deviceConfirm" in page.url or await page.get_by_text("등록안함").is_visible():
                        logger.info("Device confirmation screen detected. Clicking 'Don't Register'...")
                        await page.get_by_text("등록안함").click()
                        await asyncio.sleep(2)
                        continue

                    if "nid.naver.com/login/nojs/login" in page.url or await page.locator("#err_capslock").is_visible():
                         # Check for error text
                         pass

                    await asyncio.sleep(1)
                else:
                    # Timeout or Captcha
                    logger.warning("Login timed out or CAPTCHA triggered.")
                    await browser.close()
                    return {"status": "failed", "reason": "Login failed (Captcha or Wrong Credentials)"}

            except Exception as e:
                logger.error(f"Error during login wait: {e}")
                
            # Extract storage state
            storage = await context.storage_state()
            
            # Import to DB
            session = await import_session(db, storage)
            
            await browser.close()
            return {
                "status": "complete",
                "is_valid": session.is_valid,
                "expires_hint": session.expires_hint
            }

        except Exception as e:
            logger.error(f"Automated login failed: {e}", exc_info=True)
            await browser.close()
            return {"status": "failed", "reason": str(e)}
