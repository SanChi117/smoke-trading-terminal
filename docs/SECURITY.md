# Security policy

- Проект не принимает и не хранит exchange API keys.
- Backend не импортирует SDK биржевых аккаунтов.
- В исходниках отсутствуют методы создания ордеров, вывода средств и управления аккаунтом.
- `scripts/validate_terminal_safety.py` блокирует известные live-execution signatures.
- Paper write endpoints следует защищать `SMOKE_TERMINAL_SECRET` и reverse proxy TLS.
- SQLite/runtime файлы исключены из Git.
- Секреты передаются только через environment variables, не через репозиторий.

Если когда-либо потребуется shadow/live-интеграция, она должна быть отдельным репозиторием и отдельным решением после paper gate. Не добавляйте её в это ядро.

