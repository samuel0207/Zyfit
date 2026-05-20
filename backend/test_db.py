import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine
from sqlalchemy import text

print("--- INICIANDO DIAGNÓSTICO DE BANCO DE DADOS ---")
print(f"DATABASEURL: {os.getenv('DATABASE_URL')}")

with engine.connect() as conn:
    try:
        # Check columns of table users
        print("\nVerificando colunas da tabela 'users':")
        res = conn.execute(text("""
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'users';
        """))
        columns = res.fetchall()
        for col in columns:
            print(f"- {col[0]} ({col[1]}), Nullable: {col[2]}")
            
        if not any(col[0] == 'phone' for col in columns):
            print("\n⚠️ AVISO: A coluna 'phone' NÃO existe na tabela 'users'! O e-mail ainda está lá.")
        else:
            print("\n✅ A coluna 'phone' existe e está pronta para uso!")
            
    except Exception as e:
        print(f"Erro ao verificar tabela: {e}")
        
    try:
        # Check current users
        print("\nVerificando usuários existentes na tabela 'users':")
        res = conn.execute(text("SELECT id, name, role FROM users;"))
        users = res.fetchall()
        for u in users:
            print(f"- {u[1]} ({u[2]}) ID: {u[0]}")
    except Exception as e:
        print(f"Erro ao ler usuários: {e}")
