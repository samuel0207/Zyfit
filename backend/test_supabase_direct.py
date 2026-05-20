import os
from sqlalchemy import create_engine, text

supabase_url = "postgresql://postgres.vcvvqxnsorwzyxyoivua:153624zyfit22@aws-1-us-east-2.pooler.supabase.com:6543/postgres"

print("--- INICIANDO DIAGNÓSTICO DIRETO DO SUPABASE ---")
try:
    engine = create_engine(supabase_url)
    with engine.connect() as conn:
        print("✅ Conectado com sucesso ao Supabase PostgreSQL!")
        
        # 1. Check columns in users table
        print("\nColunas da tabela 'users' no Supabase:")
        res = conn.execute(text("""
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'users';
        """))
        columns = res.fetchall()
        for col in columns:
            print(f"- {col[0]} ({col[1]}), Nullable: {col[2]}")
            
        # 2. Check if email column still exists
        has_email = any(col[0] == 'email' for col in columns)
        has_phone = any(col[0] == 'phone' for col in columns)
        print(f"\nTem coluna 'email': {has_email}")
        print(f"Tem coluna 'phone': {has_phone}")
        
        # 3. Check existing rows
        print("\nRegistros de usuários existentes no Supabase:")
        # Select carefully based on column presence:
        if has_phone:
            res = conn.execute(text("SELECT id, name, role, phone FROM users;"))
        else:
            res = conn.execute(text("SELECT id, name, role, email FROM users;"))
            
        users = res.fetchall()
        for u in users:
            print(f"- {u[1]} ({u[2]}), Identificador: {u[3]} (ID: {u[0]})")
            
except Exception as e:
    print(f"❌ Erro durante o diagnóstico: {e}")
