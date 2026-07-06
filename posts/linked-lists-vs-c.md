---
title: Nodes That Refuse To Point To Themselves
publishedDate: 2026-07-06 09:00
tag: devlog
author: You
excerpt: Tried to implement a linked list in Rust. Ended up in a fistfight with the borrow checker over what "empty" even means.
draft: false
---

Ever wanted to do something big with your life but didn't know how to go about it? Yeah, well, tough nuts, go cry in a cave.

Today I found the entire Rust documentation on the Play Store, made by a developer whose nationality I won't try to guess because I don't want to get cancelled for stereotyping. Really nice one, always known, okay, still not guessing. Even though it's technically a web app wrapped as one (no, I'm serious, it's literally kind of a web app from the interface's appearance), it's still quite useful and all. I perused its contents for a total of five minutes before zoning out.

Anyway, I'm trying to wrap my head around implementing a linked list in Rust because I told a friend I was going to start DSA in said language, and accountability and blah blah blah, I'd rather paint a wall and watch it dry, but that sounds ill-conceived, so DSA in Rust it is.

I think it's easy to imagine what the first roadblock was: how to begin. Do I define a struct? Go straight to the linked list spawn function? Scaffold out the structure, despite it literally being a data structure? Couldn't figure shit out for the life of me, so I did what any rational youth in 2026 would do: turn to Claude for help.

Turns out I possess enough syntax knowledge to embark on this endeavor but lack the dexterity required to bend said syntax to my will, so I had to take a brief refresher on ownership, impls, enums, and that weird `Option<Some>` thing.

The next thing after this was to define the struct itself. Here I hit my first mindfuck: why is it unrusty Rust to write

```rust
struct Node<T> {
    value: T,
    next: Node<T>,
}
```

How C does it: C never hits this problem, because a linked list node just holds a raw pointer:

```c
struct Node {
    int value;
    struct Node *next;
};
```

A pointer is a fixed size no matter what it points to, so there's no infinite size issue. `next` can also just be `NULL`.

Got to give props to C here cos it lets you have that raw pointer with no pushback. Rust forces you to be explicit about ownership like a b-word, and worry about responsibility cos of the risk of "nothing being there," essentially training wheels but not really.

A brief look at documentation and one Claude conversation later: it's because that'd lead to an infinite sequence of `Node` trying to bite its own tail. The alleged solution, allegedly, is to do:

```rust
struct Node<T> {
    value: T,
    next: Option<Box<Node<T>>>,
}
```

Because then `Node` just points to a pointer of known size and stuff, as opposed to itself, and itself, and itself, and itself... you get the idea.

It was fairly smooth sailing moving forward, defining the linked list struct itself:

```rust
struct LinkedList<T> {
    head: Option<Box<Node<T>>>,
}
```

To point to the next node, such that `LinkedList` becomes the first one.

In C, however:

```c
struct LinkedList {
    struct Node *head;
};
```

An empty list is just `head = NULL`. No `Option`, no `Some`/`None`, `NULL` just means "empty" and you have to remember to check it. Pretty unsafe behavior, and unfortunately 54 years too late for Ritchie to take notes.

Then came the impl to actually construct it, so our overrated and, frankly, historically mid main function can make a call to it:

```rust
impl<T> LinkedList<T> {
    fn new() -> Self {
        LinkedList { head: None }
    }
}
```

Once again, there's no impl block in C, no method attached to the type, you'd just write a plain function and work with that straight away:

```c
struct LinkedList list_new(void) {
    struct LinkedList list;
    list.head = NULL;
    return list;
}
```

At least Rust's compiler ties `list_new` to `LinkedList` implicitly. Some other mono-character named elderly language does NOT give that much of a shit to go that far. Bell Labs, mehn.

Tapped out at this point, because my DSA is shaky at best and my Rust is even shakier. I'll probably continue tomorrow, or not, I don't know, told y'all I have a system, so don't rush me.

Anyway, that's all folks. There's no conclusion or conventional ending to this write-up. You can fuck off now.
