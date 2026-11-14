"use client";
import { stoppedOrderStatuses } from "@/lib/order-workflow";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import vi from "@fullcalendar/core/locales/vi";
import type { Order } from "@/lib/types";
import { orderStatus } from "./customer-features";
export default function OperationsCalendar({
  orders,
  onSelect,
  onRange,
}: {
  orders: Order[];
  onSelect: (order: Order) => void;
  onRange: (from: string, to: string) => void;
}) {
  const active = orders.filter((o) => !stoppedOrderStatuses.includes(o.status));
  const days = [...new Set(active.map((o) => o.deliveryDay))].sort();
  return (
    <>
      <p className="small muted">
        Lịch theo ngày giao · Hà Nội UTC+7 · Tải theo khoảng lịch, tối đa 1.000
        đơn.
      </p>
      <div className="admin-calendar">
        <FullCalendar
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            interactionPlugin,
            luxonPlugin,
          ]}
          timeZone="Asia/Ho_Chi_Minh"
          slotMinTime="08:00:00"
          slotMaxTime="22:00:00"
          initialView="dayGridMonth"
          locale={vi}
          datesSet={(range) =>
            onRange(range.startStr.slice(0, 10), range.endStr.slice(0, 10))
          }
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek",
          }}
          events={active.map((o) => ({
            id: o.id,
            title: o.buyerName,
            start: o.deliveryStart ?? `${o.deliveryDay}T09:00:00+07:00`,
            end: o.deliveryEnd ?? `${o.deliveryDay}T12:00:00+07:00`,
            allDay: false,
            backgroundColor:
              o.fulfillment === "DELIVERED" ? "#e0eadb" : "#ead9ce",
          }))}
          eventClick={(e) => {
            const order = orders.find((o) => o.id === e.event.id);
            if (order) onSelect(order);
          }}
          height="auto"
          dayMaxEvents={3}
        />
      </div>
      <div className="admin-agenda">
        {days.map((day) => (
          <section
            className="admin-panel"
            style={{ marginBottom: 15 }}
            key={day}
          >
            <div className="panel-heading">
              <h2>
                {day.slice(8)}/{day.slice(5, 7)}/{day.slice(0, 4)}
              </h2>
              <span>
                {active.filter((o) => o.deliveryDay === day).length} đơn
              </span>
            </div>
            {active
              .filter((o) => o.deliveryDay === day)
              .map((o) => (
                <button
                  className="task-preview"
                  key={o.id}
                  onClick={() => onSelect(o)}
                  style={{ width: "100%", textAlign: "left" }}
                >
                  <span>✧</span>
                  <div>
                    <strong>
                      {o.buyerName} · {o.slotLabel}
                    </strong>
                    <p>
                      {o.items[0]?.name} · {orderStatus[o.fulfillment]}
                    </p>
                  </div>
                </button>
              ))}
          </section>
        ))}
        {!days.length && (
          <div className="empty-state">
            <h2>Chưa có lịch giao.</h2>
          </div>
        )}
      </div>
    </>
  );
}
