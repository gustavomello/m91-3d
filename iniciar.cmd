@echo off
rem Dois cliques aqui: liga o servidor local e abre o navegador.
title M91 3D - servidor local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Abrir
