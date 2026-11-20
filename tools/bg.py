#!/usr/bin/env python3
"""后台启动命令（脱离当前 shell，调用结束后继续跑）：python3 tools/bg.py <日志文件> <命令...>"""
import subprocess, sys
log = open(sys.argv[1], 'w')
subprocess.Popen(sys.argv[2:], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
