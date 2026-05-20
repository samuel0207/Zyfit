import os
import sys

# Ensure backend directory is in the import path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app, seed_data
from app.database import get_db, engine, Base
from app import models, auth

client = TestClient(app)

def run_tests():
    # Force manual seed execution since TestClient without context doesn't fire startup events
    seed_data()

    print("="*60)
    print("INICIANDO TESTES AUTOMATIZADOS DO BACKEND")
    print("="*60)

    # 1. Test Seeding & Database Tables
    print("\n[TEST 1] Verificando tabelas e Seeding do Administrador...")
    db = next(get_db())
    admin_user = db.query(models.User).filter(models.User.email == "prof@treinos.com").first()
    assert admin_user is not None, "Erro: Admin padrão não foi seeded."
    assert admin_user.role == "admin", "Erro: O papel do Admin seeded não é 'admin'."
    print("👉 OK! Tabelas criadas com sucesso e Administrador seeded no banco de dados.")

    # 2. Test JWT Login Endpoint
    print("\n[TEST 2] Testando endpoint de Login REST /api/auth/login...")
    login_payload = {
        "name": "Professora Maria (Admin)", # ignored during login but matched schema
        "email": "prof@treinos.com",
        "password": "admin123"
    }
    response = client.post("/api/auth/login", json=login_payload)
    assert response.status_code == 200, f"Erro no login: {response.text}"
    token_data = response.json()
    assert "access_token" in token_data, "Erro: Access token não retornado no login."
    token = token_data["access_token"]
    print("👉 OK! Login bem-sucedido e token JWT gerado.")
    print(f"   Token Gerado (truncado): {token[:45]}...")

    # 3. Test Authenticated Route /api/auth/me
    print("\n[TEST 3] Testando rota autenticada /api/auth/me...")
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200, f"Erro ao acessar /api/auth/me: {response.text}"
    me_data = response.json()
    assert me_data["email"] == "prof@treinos.com", "Erro: Usuário incorreto retornado."
    print(f"👉 OK! Rota /api/auth/me funcionando. Identificado como: {me_data['name']} ({me_data['role']})")

    # 4. Test Student Creation (CRUD - Admin Only)
    print("\n[TEST 4] Testando criação de Aluno (CRUD - Admin Only)...")
    student_payload = {
        "name": "Pedro Aluno Teste",
        "email": "pedro@treinos.com",
        "password": "alunopassword123",
        "role": "student",
        "weight": 82.3,
        "height": 1.81,
        "goals": "Aumento de massa muscular"
    }
    response = client.post("/api/students", json=student_payload, headers=headers)
    assert response.status_code == 201, f"Erro ao criar aluno: {response.text}"
    student_data = response.json()
    student_id = student_data["id"]
    print(f"👉 OK! Aluno criado com sucesso. ID: {student_id}")

    # 5. Test Workout & Exercise creation for Student
    print("\n[TEST 5] Criando Ficha de Treino e Exercício para o aluno...")
    # Create Workout Sheet
    workout_payload = {
        "student_id": student_id,
        "title": "Treino A - Peito & Tríceps",
        "description": "Foco em progressão de carga lenta."
    }
    response = client.post("/api/workouts", json=workout_payload, headers=headers)
    assert response.status_code == 201, f"Erro ao criar ficha de treino: {response.text}"
    workout_data = response.json()
    workout_id = workout_data["id"]
    print(f"👉 OK! Ficha de Treino criada com sucesso. ID: {workout_id}")

    # Add Exercise to Workout Sheet
    exercise_payload = {
        "workout_id": workout_id,
        "name": "Supino Inclinado Halteres",
        "sets": 4,
        "repetitions": "12 repetições",
        "rest_time": "90s",
        "video_url": "https://www.youtube.com/watch?v=s3NfNDtZ5sM",
        "order_index": 1
    }
    response = client.post("/api/exercises", json=exercise_payload, headers=headers)
    assert response.status_code == 201, f"Erro ao adicionar exercício: {response.text}"
    exercise_data = response.json()
    exercise_id = exercise_data["id"]
    print(f"👉 OK! Exercício adicionado com sucesso. ID: {exercise_id}")

    # 6. Test Student Portal Logins & Workouts list
    print("\n[TEST 6] Testando login e Portal do Aluno...")
    # Login as student
    student_login = {
        "name": "Pedro Aluno Teste",
        "email": "pedro@treinos.com",
        "password": "alunopassword123"
    }
    response = client.post("/api/auth/login", json=student_login)
    assert response.status_code == 200, f"Erro login do aluno: {response.text}"
    student_token = response.json()["access_token"]
    student_headers = {"Authorization": f"Bearer {student_token}"}
    
    # Get student workouts
    response = client.get("/api/student-portal/my-workouts", headers=student_headers)
    assert response.status_code == 200, f"Erro obter treinos portal: {response.text}"
    portal_workouts = response.json()
    assert len(portal_workouts) == 1, "Erro: Aluno não listou o treino associado."
    assert portal_workouts[0]["exercises"][0]["completed_today"] is False, "Erro: Deveria estar pendente."
    print("👉 OK! Aluno logou e recuperou o treino vigente com status correto.")

    # 7. Test Student Marking Exercise as completed
    print("\n[TEST 7] Testando marcação de conclusão de exercício pelo aluno...")
    response = client.post(f"/api/student-portal/exercises/{exercise_id}/complete", headers=student_headers)
    assert response.status_code == 200, f"Erro ao concluir exercício: {response.text}"
    
    # Verify it shows completed_today = True now
    response = client.get("/api/student-portal/my-workouts", headers=student_headers)
    portal_workouts = response.json()
    assert portal_workouts[0]["exercises"][0]["completed_today"] is True, "Erro: Exercício deveria aparecer concluído hoje."
    print("👉 OK! Aluno concluiu o exercício com sucesso e o status atualizou dinamicamente.")

    # Cleanup Database (Delete testing users and workouts Cascade)
    print("\n[CLEANUP] Removendo registros de teste...")
    response = client.delete(f"/api/students/{student_id}", headers=headers)
    assert response.status_code == 204, "Erro ao remover aluno no cleanup."
    print("👉 OK! Banco de dados de teste limpo com sucesso.")

    print("\n" + "="*60)
    print("🎉 TODOS OS TESTES DO BACKEND PASSARAM COM SUCESSO! 🎉")
    print("="*60 + "\n")

if __name__ == "__main__":
    run_tests()
