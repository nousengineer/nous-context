@echo off
cd /d "%~dp0..\.."
node "%~dp0dist\index.js" %*
