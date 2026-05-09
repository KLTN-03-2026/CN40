// stats-export.js — PDF and Excel client-side export for the stats dashboard.
// Depends on: jsPDF (window.jspdf), jsPDF-autoTable plugin, SheetJS (window.XLSX)
// Data sourced from window.StatsManager.getCachedData()
(function () {
  "use strict";

  function warn(msg) {
    if (window.Utils?.alert) {
      window.Utils.alert(msg, "Thong bao", "warning");
    } else {
      alert(msg);
    }
  }

  function err(msg) {
    if (window.Utils?.alert) {
      window.Utils.alert(msg, "Loi", "error");
    } else {
      alert(msg);
    }
  }

  function today() {
    return new Date().toISOString().split("T")[0];
  }

  function minsToH(m) {
    return Math.round((m || 0) / 60) + "h";
  }

  function pct(completed, total) {
    return total ? Math.round((completed / total) * 100) + "%" : "0%";
  }

  function buildDailyRows(daily) {
    return (daily || []).map(function (d) {
      return [d.date, d.total, d.completed, pct(d.completed, d.total)];
    });
  }

  // ── PDF ──────────────────────────────────────────────────────────────────────

  function exportPDF() {
    var data = window.StatsManager?.getCachedData?.();
    if (!data) { warn("Chua co du lieu thong ke. Hay tai du lieu truoc."); return; }
    if (!window.jspdf) { err("Thu vien PDF chua tai xong. Vui long thu lai sau."); return; }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    // Title
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Bao cao thong ke cong viec", 14, 20);

    // Date generated
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text("Ngay xuat: " + today(), 14, 28);
    doc.setTextColor(0, 0, 0);

    // Summary block
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Tong quan", 14, 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    var lines = [
      "Tong cong viec : " + (data.total || 0),
      "Hoan thanh     : " + (data.completed || 0) + " (" + (data.percent || 0) + "%)",
      "Chua hoan thanh: " + (data.pending || 0),
      "Streak         : " + (data.streak || 0) + " ngay lien tiep",
      "Thoi gian du kien: " + minsToH(data.totalMinutes),
      "Thoi gian da lam : " + minsToH(data.doneMinutes),
    ];
    lines.forEach(function (line, i) {
      doc.text(line, 14, 46 + i * 7);
    });

    // Daily detail table
    var dailyRows = buildDailyRows(data.daily);
    if (dailyRows.length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Chi tiet theo ngay", 14, 96);

      doc.autoTable({
        startY: 100,
        head: [["Ngay", "Tong", "Hoan thanh", "Ty le"]],
        body: dailyRows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        columnStyles: { 3: { halign: "right" } },
        margin: { left: 14, right: 14 },
      });
    }

    // Priority table
    if (data.priority && typeof data.priority === "object") {
      var prioRows = Object.entries(data.priority).map(function (kv) {
        return [kv[0], kv[1]];
      });
      if (prioRows.length) {
        var finalY = doc.lastAutoTable?.finalY || 100;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Phan bo theo do uu tien", 14, finalY + 10);

        doc.autoTable({
          startY: finalY + 14,
          head: [["Do uu tien", "So luong"]],
          body: prioRows,
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
          margin: { left: 14, right: 14 },
        });
      }
    }

    doc.save("thong-ke-" + today() + ".pdf");
  }

  // ── Excel ─────────────────────────────────────────────────────────────────────

  function exportExcel() {
    var data = window.StatsManager?.getCachedData?.();
    if (!data) { warn("Chua co du lieu thong ke. Hay tai du lieu truoc."); return; }
    if (!window.XLSX) { err("Thu vien Excel chua tai xong. Vui long thu lai sau."); return; }

    var wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    var summary = [
      ["Bao cao thong ke cong viec"],
      ["Ngay xuat", today()],
      [],
      ["Hang muc", "Gia tri"],
      ["Tong cong viec", data.total || 0],
      ["Hoan thanh", data.completed || 0],
      ["Ty le hoan thanh", (data.percent || 0) + "%"],
      ["Chua hoan thanh", data.pending || 0],
      ["Streak (ngay lien tiep)", data.streak || 0],
      ["Thoi gian du kien (h)", Math.round((data.totalMinutes || 0) / 60)],
      ["Thoi gian da lam (h)", Math.round((data.doneMinutes || 0) / 60)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Tong quan");

    // Sheet 2: Daily detail
    var dailyRows = buildDailyRows(data.daily);
    if (dailyRows.length) {
      var dailySheet = [["Ngay", "Tong", "Hoan thanh", "Ty le"]].concat(dailyRows);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailySheet), "Chi tiet ngay");
    }

    // Sheet 3: Priority breakdown
    if (data.priority && typeof data.priority === "object") {
      var prioSheet = [["Do uu tien", "So luong"]].concat(
        Object.entries(data.priority).map(function (kv) { return [kv[0], kv[1]]; })
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prioSheet), "Uu tien");
    }

    // Sheet 4: Category breakdown
    if (Array.isArray(data.categories) && data.categories.length) {
      var catSheet = [["Danh muc", "So luong"]].concat(
        data.categories.map(function (c) { return [c.name || c.label || c.category || "", c.count || c.value || 0]; })
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catSheet), "Danh muc");
    }

    XLSX.writeFile(wb, "thong-ke-" + today() + ".xlsx");
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  window.StatsExport = {
    init: function () {
      var pdfBtn = document.getElementById("btn-export-pdf");
      var xlsBtn = document.getElementById("btn-export-excel");
      if (pdfBtn) pdfBtn.onclick = exportPDF;
      if (xlsBtn) xlsBtn.onclick = exportExcel;
    },
    exportPDF: exportPDF,
    exportExcel: exportExcel,
  };
})();
