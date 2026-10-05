#!/bin/sh
# Wraps Chrome headless so `launch-chrome` can be tested without a window. macOS path; edit for other OSes.
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new "$@"
