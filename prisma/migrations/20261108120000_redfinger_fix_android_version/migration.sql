-- Data fix: sinkron versi lama mengisi androidVersion dari padGrade (kelas VIP, bukan versi Android).
-- Kosongkan untuk device hasil sinkron; versi asli terisi lagi dari panel device saat Replace dibuka.
UPDATE "RedfingerAccount" SET "androidVersion" = NULL WHERE "loginId" IS NOT NULL;
