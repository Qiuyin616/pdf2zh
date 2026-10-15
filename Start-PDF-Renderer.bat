@echo off
setlocal
title pdf2zh PDF Renderer
pushd "%~dp0"
if errorlevel 1 exit /b 1
if not defined SEMANTIC_RENDER_PORT set "SEMANTIC_RENDER_PORT=8765"
if not defined PANDOC_BIN set "PANDOC_BIN=pandoc"
node --version >nul 2>nul
if errorlevel 1 goto missing_node
"%PANDOC_BIN%" --version >nul 2>nul
if errorlevel 1 goto missing_pandoc
xelatex --version >nul 2>nul
if errorlevel 1 goto missing_tex
pdftotext -v >nul 2>nul
if errorlevel 1 goto missing_poppler
pdfinfo -v >nul 2>nul
if errorlevel 1 goto missing_poppler
set "CTEX="
for /f "delims=" %%F in ('kpsewhich ctexart.cls 2^>nul') do set "CTEX=%%F"
if not defined CTEX goto missing_tex
if not exist "service\render-service.mjs" goto missing_script
echo Starting the PDF renderer...
echo Zotero render service: http://127.0.0.1:%SEMANTIC_RENDER_PORT%
echo Keep this window open. Press Ctrl+C to stop the service.
node "service\render-service.mjs"
set "RESULT=%ERRORLEVEL%"
echo Renderer stopped. Exit code: %RESULT%
popd
pause
exit /b %RESULT%
:missing_node
echo ERROR: Install Node.js and reopen this launcher.
goto failed
:missing_pandoc
echo ERROR: Install Pandoc or set PANDOC_BIN to its executable path.
goto failed
:missing_tex
echo ERROR: Install XeLaTeX and ctexart using a full TeX Live distribution.
goto failed
:missing_script
echo ERROR: Download the complete repository, including the service directory.
goto failed
:missing_poppler
echo ERROR: Install Poppler and add pdftotext and pdfinfo to PATH for PDF layout validation.
:failed
popd
pause
exit /b 1
