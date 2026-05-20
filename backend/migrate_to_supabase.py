import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add the current directory to sys.path to allow imports from app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import Base
from app.models import User, Workout, Exercise, ExerciseCompletion

def main():
    print("============================================================")
    print("MIGRADOR DE BANCO DE DADOS: SQLITE ➔ SUPABASE POSTGRESQL")
    print("============================================================")

    # 1. Connect to local SQLite
    sqlite_db_path = "treinos.db"
    if not os.path.exists(sqlite_db_path):
        print(f"❌ Erro: O banco de dados local '{sqlite_db_path}' não foi encontrado.")
        print("Certifique-se de rodar o uvicorn ou os testes pelo menos uma vez para gerar os dados locais.")
        return

    sqlite_url = f"sqlite:///{sqlite_db_path}"
    print(f"🔌 Conectando ao SQLite local: {sqlite_url}")
    sqlite_engine = create_engine(sqlite_url)
    SqliteSession = sessionmaker(bind=sqlite_engine)
    sqlite_session = SqliteSession()

    # 2. Get Supabase PostgreSQL Connection String
    supabase_url = os.getenv("DATABASE_URL")
    if not supabase_url:
        print("\n🔑 Nenhuma variável DATABASE_URL encontrada no ambiente.")
        print("Digite a URL de conexão do PostgreSQL do seu Supabase:")
        print("Exemplo: postgresql://postgres.vcvvqxnsorwzyxyoivua:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")
        supabase_url = input("\nURL de Conexão Supabase: ").strip()

    if not supabase_url:
        print("❌ Operação cancelada. A URL de conexão é obrigatória.")
        return

    print("\n🔌 Conectando ao Supabase PostgreSQL...")
    try:
        supabase_engine = create_engine(supabase_url)
        SupabaseSession = sessionmaker(bind=supabase_engine)
        supabase_session = SupabaseSession()
        
        # Test connection
        conn = supabase_engine.connect()
        conn.close()
        print("✅ Conectado com sucesso ao Supabase!")
    except Exception as e:
        print(f"❌ Falha na conexão com o Supabase: {e}")
        return

    # 3. Create tables in Supabase
    print("\n📐 Criando tabelas no Supabase (se ainda não existirem)...")
    try:
        Base.metadata.create_all(bind=supabase_engine)
        print("✅ Tabelas criadas com sucesso!")
    except Exception as e:
        print(f"❌ Falha ao criar tabelas: {e}")
        return

    # 4. Migrate Users
    print("\n👥 Migrando Usuários...")
    sqlite_users = sqlite_session.query(User).all()
    print(f"Encontrados {len(sqlite_users)} usuários no SQLite local.")
    
    for u in sqlite_users:
        # Check if user already exists
        exists = supabase_session.query(User).filter(User.id == u.id).first()
        if exists:
            print(f"   [Ignorado] Usuário {u.phone} já existe no Supabase.")
            continue
            
        new_user = User(
            id=u.id,
            name=u.name,
            phone=u.phone,
            password_hash=u.password_hash,
            password=u.password,
            role=u.role,
            weight=u.weight,
            height=u.height,
            goals=u.goals,
            created_at=u.created_at,
            updated_at=u.updated_at
        )
        supabase_session.add(new_user)
        print(f"   [Migrado] Usuário: {u.name} ({u.role})")
    
    supabase_session.commit()

    # 5. Migrate Workouts
    print("\n📋 Migrando Fichas de Treino...")
    sqlite_workouts = sqlite_session.query(Workout).all()
    print(f"Encontradas {len(sqlite_workouts)} fichas de treino no SQLite local.")
    
    for w in sqlite_workouts:
        exists = supabase_session.query(Workout).filter(Workout.id == w.id).first()
        if exists:
            print(f"   [Ignorado] Ficha {w.title} já existe no Supabase.")
            continue
            
        new_workout = Workout(
            id=w.id,
            student_id=w.student_id,
            title=w.title,
            description=w.description,
            created_at=w.created_at,
            updated_at=w.updated_at
        )
        supabase_session.add(new_workout)
        print(f"   [Migrado] Ficha: {w.title}")
        
    supabase_session.commit()

    # 6. Migrate Exercises
    print("\n🏋️ Migrando Exercícios...")
    sqlite_exercises = sqlite_session.query(Exercise).all()
    print(f"Encontrados {len(sqlite_exercises)} exercícios no SQLite local.")
    
    for ex in sqlite_exercises:
        exists = supabase_session.query(Exercise).filter(Exercise.id == ex.id).first()
        if exists:
            print(f"   [Ignorado] Exercício {ex.name} já existe no Supabase.")
            continue
            
        new_exercise = Exercise(
            id=ex.id,
            workout_id=ex.workout_id,
            name=ex.name,
            sets=ex.sets,
            repetitions=ex.repetitions,
            rest_time=ex.rest_time,
            video_url=ex.video_url,
            order_index=ex.order_index,
            created_at=ex.created_at
        )
        supabase_session.add(new_exercise)
        print(f"   [Migrado] Exercício: {ex.name}")
        
    supabase_session.commit()

    # 7. Migrate Completions
    print("\n✅ Migrando Logs de Conclusão...")
    sqlite_completions = sqlite_session.query(ExerciseCompletion).all()
    print(f"Encontrados {len(sqlite_completions)} logs de conclusão no SQLite local.")
    
    for c in sqlite_completions:
        exists = supabase_session.query(ExerciseCompletion).filter(ExerciseCompletion.id == c.id).first()
        if exists:
            print(f"   [Ignorado] Conclusão ID {c.id} já existe no Supabase.")
            continue
            
        new_completion = ExerciseCompletion(
            id=c.id,
            student_id=c.student_id,
            exercise_id=c.exercise_id,
            completed_date=c.completed_date,
            completed_at=c.completed_at
        )
        supabase_session.add(new_completion)
        print(f"   [Migrado] Log de conclusão do Exercício ID {c.exercise_id}")
        
    supabase_session.commit()

    print("\n============================================================")
    print("🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO PARA O SUPABASE! 🎉")
    print("============================================================")

if __name__ == "__main__":
    main()
