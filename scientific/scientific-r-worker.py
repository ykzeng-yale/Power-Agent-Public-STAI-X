#!/usr/bin/env python3
"""Linux-only restricted R worker. Fails closed if restrictions cannot be set."""
import argparse
import ctypes
import ctypes.util
import errno
import os
import resource
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--uid', type=int, required=True)
parser.add_argument('--gid', type=int, required=True)
parser.add_argument('--cpu-seconds', type=int, required=True)
parser.add_argument('--memory-mb', type=int, default=1536)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command and args.command[0] == '--' else args.command

try:
    if not sys.platform.startswith('linux') or os.geteuid() != 0 or args.uid < 100000 or args.gid < 100000 or not command:
        raise RuntimeError('restricted worker requires Linux root launcher and a unique unprivileged identity')
    library_path = ctypes.util.find_library('seccomp')
    if not library_path:
        raise RuntimeError('libseccomp is unavailable')
    seccomp = ctypes.CDLL(library_path, use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_rule_add.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (args.cpu_seconds, args.cpu_seconds + 1))
    resource.setrlimit(resource.RLIMIT_AS, (args.memory_mb * 1024 ** 2, args.memory_mb * 1024 ** 2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024 ** 2, 100 * 1024 ** 2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
    os.setgroups([])
    os.setgid(args.gid)
    os.setuid(args.uid)
    # Linux PR_SET_NO_NEW_PRIVS. Executed descendants inherit restrictions.
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise RuntimeError('could not set no_new_privs')
    context = seccomp.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError('could not initialize seccomp')
    try:
        deny = 0x00050000 | errno.EPERM  # SCMP_ACT_ERRNO(EPERM)
        for name in ['socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4',
                     'sendto', 'sendmsg', 'sendmmsg', 'recvfrom', 'recvmsg', 'recvmmsg', 'socketcall',
                     'ptrace', 'process_vm_readv', 'process_vm_writev', 'mount', 'umount2',
                     'unshare', 'setns', 'setsid', 'setpgid', 'bpf', 'userfaultfd', 'io_uring_setup', 'io_uring_enter', 'io_uring_register']:
            number = seccomp.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and seccomp.seccomp_rule_add(context, deny, number, 0) != 0:
                raise RuntimeError(f'could not restrict syscall {name}')
        if seccomp.seccomp_load(context) != 0:
            raise RuntimeError('could not load seccomp')
    finally:
        seccomp.seccomp_release(context)
    os.execvpe(command[0], command, os.environ)
except Exception as error:
    sys.stderr.write(f'POWER_AGENT_WORKER_RESTRICTION_FAILED: {error}\n')
    sys.exit(125)
