@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem ============================================================
rem  启动「内置人物包管理器」：起本地静态服务并打开浏览器
rem
rem    start.bat                默认 8123，占用则自动往后找
rem    start.bat --port 9000    指定端口
rem    start.bat --no-browser   只起服务
rem
rem   端口被本工具旧实例占着：先结束它再接管同一端口；被别的程序占着：
rem   不杀它，改用下一个空闲端口（--strict-port 直接报错退出）。
rem
rem  依赖：Python 3（标准库即可，不需要 pip 安装东西）
rem ============================================================
cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo [错误] 未找到 Python 3，请安装后把 python.exe 加入 PATH。
  echo 下载： https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

%PY% "%~dp0serve.py" %*
if errorlevel 1 (
  echo.
  echo [提示] 服务异常退出。常见原因：端口被占用、Python 版本过低。
  pause
)
endlocal
