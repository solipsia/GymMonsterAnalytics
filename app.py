"""app.py — Flask application entry point. Registers blueprints."""

import secrets
from flask import Flask

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

# Register blueprints
from routes.auth import auth_bp
from routes.workouts import workouts_bp
from routes.settings import settings_bp

app.register_blueprint(auth_bp)
app.register_blueprint(workouts_bp)
app.register_blueprint(settings_bp)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
