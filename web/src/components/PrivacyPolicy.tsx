// Basic privacy policy for early-access waitlist (152-FZ style summary).

import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "./Router.js";

export const PRIVACY_VERSION = "2026-07-20";

export const PRIVACY_SUMMARY = [
  "Оператор обрабатывает email, имя/организацию и текст заявки только для связи по раннему доступу к A2CHATSKY.",
  "Данные не продаются и не передаются третьим лицам, кроме случаев, когда это требует закон или инфраструктура доставки писем (SMTP).",
  "Вы можете отозвать согласие, написав на адрес, указанный в полной политике. Заявка будет удалена из списка ожидания.",
  "Отправка формы означает согласие на обработку указанных персональных данных для этой цели.",
] as const;

/** Compact consent panel — opens when the email field is focused. */
export function PrivacyConsentPanel({
  open,
  agreed,
  onAgree,
  onOpenFull,
}: {
  open: boolean;
  agreed: boolean;
  onAgree: (v: boolean) => void;
  onOpenFull: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="mt-2 border border-amber-400/25 bg-amber-400/[0.04] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400/80">
              Политика · заявки
            </p>
            <ul className="mt-3 space-y-2 font-mono text-[11px] leading-relaxed text-white/55">
              {PRIVACY_SUMMARY.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-400/60" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => onAgree(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-amber-400"
              />
              <span className="font-mono text-[12px] leading-snug text-white/75">
                Соглашаюсь на обработку персональных данных для рассмотрения заявки.{" "}
                <button
                  type="button"
                  onClick={onOpenFull}
                  className="text-amber-300/90 underline-offset-2 hover:underline"
                >
                  Полный текст
                </button>
              </span>
            </label>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Full privacy page content. */
export default function PrivacyPolicy() {
  return (
    <main className="min-h-[100dvh] bg-black px-6 pb-24 pt-24 md:pt-28">
      <article className="mx-auto max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-400/70">
          Документ · v{PRIVACY_VERSION}
        </p>
        <h1 className="mt-3 font-display text-3xl uppercase text-white md:text-5xl">
          Политика обработки персональных данных
        </h1>
        <p className="mt-4 font-mono text-[13px] leading-relaxed text-white/45">
          Настоящая политика описывает, как сервис A2CHATSKY (далее — «Сервис», сайт{" "}
          <span className="text-white/70">a2chatsky.ru</span>) обрабатывает персональные данные при
          подаче заявки на ранний доступ и при использовании кабинета.
        </p>

        <Section title="1. Оператор">
          Оператором персональных данных является владелец Сервиса A2CHATSKY. По вопросам обработки
          данных пишите на{" "}
          <a href="mailto:privacy@a2chatsky.ru" className="text-amber-300/90 hover:underline">
            privacy@a2chatsky.ru
          </a>
          .
        </Section>

        <Section title="2. Какие данные собираем">
          При заявке на ранний доступ: адрес электронной почты; имя или название организации
          (необязательно); комментарий к заявке (необязательно); дата и факт согласия с этой
          политикой. При регистрации по приглашению дополнительно — данные профиля и учётной
          записи, необходимые для работы кабинета.
        </Section>

        <Section title="3. Цели обработки">
          Рассмотрение заявки и связь по вопросам доступа; направление приглашения; обеспечение
          работы кабинета и API; исполнение требований законодательства РФ.
        </Section>

        <Section title="4. Правовые основания">
          Согласие субъекта персональных данных (ст. 6, 9 Федерального закона № 152-ФЗ «О
          персональных данных»), а также исполнение договора/оферты при использовании Сервиса
          после предоставления доступа.
        </Section>

        <Section title="5. Хранение и передача">
          Данные заявок хранятся в защищённом хранилище Сервиса. Передача третьим лицам не
          осуществляется, за исключением: обязательных требований закона; провайдеров
          инфраструктуры (хостинг, в будущем — SMTP для писем), действующих по поручению
          оператора. Маркетинговой рассылки без отдельного согласия нет.
        </Section>

        <Section title="6. Срок хранения">
          Заявки хранятся до рассмотрения и предоставления/отказа в доступе, либо до отзыва
          согласия, но не дольше, чем это необходимо для указанных целей, если иной срок не
          установлен законом.
        </Section>

        <Section title="7. Права субъекта">
          Вы вправе запросить сведения об обработке, потребовать уточнения, блокирования или
          удаления данных, отозвать согласие. Для этого напишите на privacy@a2chatsky.ru с темой
          «Персональные данные» и укажите email из заявки.
        </Section>

        <Section title="8. Согласие при заявке">
          Нажимая «Отправить заявку» и отмечая согласие в форме, вы подтверждаете, что
          ознакомились с настоящей политикой и даёте согласие на обработку указанных данных для
          целей раннего доступа.
        </Section>

        <p className="mt-10 font-mono text-[11px] text-white/30">
          Дата редакции: {PRIVACY_VERSION}
        </p>
        <p className="mt-6">
          <Link
            to="/"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40 transition hover:text-white/70"
          >
            ← На главную
          </Link>
        </p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-white/10 pt-6">
      <h2 className="font-display text-lg uppercase text-white md:text-xl">{title}</h2>
      <p className="mt-3 font-mono text-[13px] leading-relaxed text-white/55">{children}</p>
    </section>
  );
}
