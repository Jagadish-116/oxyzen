import os
import sys
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def main():
    print("==================================================")
    print(">> STARTING OXYZEN LUXURY MUSIC PLATFORM <<")
    print("==================================================")
    
    # Path to virtual environment python / uvicorn
    if sys.platform == "win32":
        python_bin = os.path.join(os.path.dirname(__file__), ".venv", "Scripts", "python.exe")
    else:
        python_bin = os.path.join(os.path.dirname(__file__), ".venv", "bin", "python")

    if not os.path.exists(python_bin):
        python_bin = sys.executable

    port = os.environ.get("PORT", "8000")
    
    host = os.environ.get("HOST", "127.0.0.1")
    
    cmd = [
        python_bin, "-m", "uvicorn",
        "backend.server:app",
        "--host", host,
        "--port", port,
        "--reload"
    ]
    
    print(f"-> Launching server on http://localhost:{port}")
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n>> Oxyzen stopped.")

if __name__ == "__main__":
    main()
