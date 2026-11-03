-- Visitantes por QR code. Aditiva: não altera dados existentes.

-- Church.visitToken: preenche as igrejas já existentes com um valor único. O default no banco é
-- mantido de propósito: o código anterior ao deploy continua conseguindo inserir igrejas.
ALTER TABLE "Church" ADD COLUMN "visitToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX "Church_visitToken_key" ON "Church"("visitToken");

CREATE TABLE "Visit" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "eventId" INTEGER,
    "isFirstVisit" BOOLEAN NOT NULL DEFAULT true,
    "howKnew" TEXT,
    "prayerRequest" TEXT,
    "wantsContact" BOOLEAN NOT NULL DEFAULT true,
    "followUpStatus" TEXT NOT NULL DEFAULT 'NOVO',
    "followUpNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Visit_churchId_createdAt_idx" ON "Visit"("churchId", "createdAt");
CREATE INDEX "Visit_followUpStatus_idx" ON "Visit"("followUpStatus");

ALTER TABLE "Visit" ADD CONSTRAINT "Visit_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mesma proteção das demais tabelas (acesso só pelo servidor, não pela API pública do Supabase).
ALTER TABLE "Visit" ENABLE ROW LEVEL SECURITY;
