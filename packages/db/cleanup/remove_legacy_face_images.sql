-- Executar somente depois de implantar e verificar API e motor facial novos.
-- Mantido fora de migrations para não apagar fotos durante a troca dos serviços.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM face_profiles p
      JOIN guests g ON g.id = p.guest_id
     WHERE g.deleted_at IS NULL AND p.image_ciphertext IS NOT NULL
       AND g.person_face_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Existem fotos antigas sem perfil compartilhado. Resolva os conflitos antes da limpeza.';
  END IF;
END $$;

ALTER TABLE guests DROP COLUMN face_profile_id;
DROP TABLE face_profiles;

COMMIT;
