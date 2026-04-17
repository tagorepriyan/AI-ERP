async function test() {
  const res = await fetch("http://127.0.0.1:4000/students/seed", {
    method: "POST",
    headers: {
      "x-tenant-id": "default-campus",
      "Content-Type": "application/json"
    }
  });
  const text = await res.text();
  console.log(res.status, text);
}
test();

